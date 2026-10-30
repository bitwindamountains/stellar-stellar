import json
from datetime import date

import httpx
import pytest

from postpilot.models import StoreError
from postpilot.supabase_repo import SupabaseRepository

ACCOUNTS = [
    {
        "id": 5,
        "name": "Kape",
        "fb_page_id": "PAGE",
        "ig_user_id": "IG",
        "token_env": "META_TOKEN_KAPE",
        "timezone": "Asia/Manila",
    }
]
POSTS = [
    {
        "num": 12,
        "account_id": 5,
        "platforms": ["facebook", "tiktok"],
        "publish_at": "2026-10-05T10:00:00+00:00",
        "caption": "hi",
        "media_type": "video",
        "media_urls": ["https://x/a.mp4", "https://x/b.mp4"],
        "link": "",
        "status": "scheduled",
        "attempts": 1,
        "claimed_at": None,
        "fb_post_id": "",
        "fb_permalink": "",
        "ig_media_id": "",
        "ig_permalink": "",
        "tg_message_id": "",
        "last_error": "",
        "posted_at": None,
    }
]


def repo(handler):
    calls = []

    def record(request):
        calls.append(request)
        return handler(request)

    return SupabaseRepository(
        "https://abc.supabase.co/", "SERVICEKEY", http=httpx.Client(transport=httpx.MockTransport(record))
    ), calls


def serve(request):
    if request.url.path.endswith("/accounts"):
        return httpx.Response(200, json=ACCOUNTS)
    if request.url.path.endswith("/connections"):
        return httpx.Response(200, json=[{"account_id": 5, "platform": "x"}])
    if request.url.path.endswith("/posts") and request.method == "GET":
        return httpx.Response(200, json=POSTS)
    return httpx.Response(204)


def test_load_maps_rows_to_post_cells_in_account_time():
    r, calls = repo(serve)
    posts, accounts = r.load()
    assert (
        calls[0].headers["apikey"] == "SERVICEKEY"
        and calls[0].headers["Authorization"] == "Bearer SERVICEKEY"
    )
    assert "SERVICEKEY" not in str(calls[0].url)
    assert accounts["5"].fb_page_id == "PAGE" and accounts["5"].token_env == "META_TOKEN_KAPE"
    p = posts[0]
    assert p.row == 12 and p.get("account") == "5"
    assert p.platforms == ["facebook", "tiktok"]
    assert p.media_urls == ["https://x/a.mp4", "https://x/b.mp4"]
    assert p.get("publish_at") == "2026-10-05 18:00"  # Manila
    assert p.get("attempts") == "1" and p.get("claimed_at") == ""


def test_load_only_fetches_rows_the_publisher_can_act_on():
    r, calls = repo(serve)
    r.load()
    url = str(next(c.url for c in calls if c.url.path.endswith("/posts")))
    assert "status=in.%28draft%2Cscheduled%2Cpartial%2Cposting%29" in url or (
        "status=in.(draft,scheduled,partial,posting)" in url
    )


def test_load_marks_connected_logins():
    r, _ = repo(serve)
    _, accounts = r.load()
    assert accounts["5"].connected == frozenset({"x"})


def test_tokens_read_through_service_role_rpc():
    def handler(request):
        assert request.url.path.endswith("/rpc/connection_tokens")
        assert json.loads(request.content) == {"p_account": 5, "p_platform": "x"}
        return httpx.Response(200, json=[{"tokens": '{"access_token": "A"}', "expires_at": None}])

    r, _ = repo(handler)
    assert r.tokens("5", "x") == ({"access_token": "A"}, "")


def test_tokens_none_when_not_connected():
    r, _ = repo(lambda request: httpx.Response(200, json=[]))
    assert r.tokens("5", "tiktok") is None


def test_save_tokens_only_updates_an_existing_login():
    r, calls = repo(lambda request: httpx.Response(200, json=True))
    tokens = {"access_token": "A", "refresh_token": "R"}
    assert r.save_tokens("5", "x", tokens, "2026-10-28T12:00:00+00:00") is True
    body = json.loads(calls[0].content)
    assert calls[0].url.path.endswith("/rpc/update_connection_tokens")
    assert body["p_tokens"] == '{"access_token": "A", "refresh_token": "R"}'


def test_save_tokens_reports_a_disconnected_login():
    r, _ = repo(lambda request: httpx.Response(200, json=False))
    assert r.save_tokens("5", "x", {"access_token": "A"}, "") is False


def test_write_patches_each_post_with_typed_values():
    r, calls = repo(serve)
    r.write(
        {
            12: {
                "status": "posting",
                "attempts": "2",
                "claimed_at": "2026-10-05T10:00:00+00:00",
                "posted_at": "",
            }
        }
    )
    r.write({})
    assert len(calls) == 1
    assert calls[0].method == "PATCH" and "num=eq.12" in str(calls[0].url)
    assert json.loads(calls[0].content) == {
        "status": "posting",
        "attempts": 2,
        "claimed_at": "2026-10-05T10:00:00+00:00",
        "posted_at": None,
    }


def test_errors_are_plain_and_hide_key():
    r, _ = repo(lambda req: httpx.Response(401, json={"message": "Invalid API key"}))
    with pytest.raises(StoreError, match="401.*Invalid API key") as e:
        r.load()
    assert "SERVICEKEY" not in str(e.value)


def test_network_error_hides_details():
    def boom(req):
        raise httpx.ConnectError("boom https://abc.supabase.co?apikey=SERVICEKEY", request=req)

    r, _ = repo(boom)
    with pytest.raises(StoreError) as e:
        r.load()
    assert "SERVICEKEY" not in str(e.value)


def test_record_run_inserts_counts():
    r, calls = repo(serve)
    r.record_run(posted=2, partial=1, failed=0, missed=3, duration_ms=1500, dry_run=False)
    assert calls[0].method == "POST" and calls[0].url.path.endswith("/runs")
    assert json.loads(calls[0].content) == {
        "posted": 2,
        "partial": 1,
        "failed": 0,
        "missed": 3,
        "duration_ms": 1500,
        "dry_run": False,
    }


def test_variants_object_loads_as_json_text():
    rows = [{**POSTS[0], "variants": {"youtube": {"title": "Latte art"}}}]

    def handler(request):
        if request.url.path.endswith("/posts"):
            return httpx.Response(200, json=rows)
        return serve(request)

    r, _ = repo(handler)
    posts, _ = r.load()
    assert posts[0].title_for("youtube") == "Latte art"


def test_count_live_between_filters_window_and_status():
    from datetime import UTC, datetime

    r, calls = repo(lambda req: httpx.Response(200, json=[{"num": 1}, {"num": 2}]))
    n = r.count_live_between(datetime(2026, 10, 4, 16, tzinfo=UTC), datetime(2026, 10, 5, 16, tzinfo=UTC))
    assert n == 2
    q = calls[0].url.params
    assert q.get_list("publish_at") == ["gte.2026-10-04T16:00:00+00:00", "lt.2026-10-05T16:00:00+00:00"]
    assert q["status"] == "not.in.(failed,missed)"


def test_claim_is_conditional_and_returns_stored_row():
    def handler(request):
        if request.method == "PATCH":
            num = request.url.params["num"]
            assert request.url.params["status"] == "in.(scheduled,partial)"
            assert request.headers["Prefer"] == "return=representation"
            # Post 12 is still scheduled; post 13 was edited to draft (or deleted) in the app meanwhile.
            return httpx.Response(200, json=[{**POSTS[0], "caption": "stored now"}] if num == "eq.12" else [])
        return serve(request)

    r, calls = repo(handler)
    r.load()
    claimed = r.claim(
        {12: {"status": "posting", "attempts": "2"}, 13: {"status": "posting", "attempts": "1"}}
    )
    assert list(claimed) == [12]
    assert claimed[12].get("caption") == "stored now"
    patch = next(c for c in calls if c.method == "PATCH")
    assert json.loads(patch.content) == {"status": "posting", "attempts": 2}


def test_stats_object_loads():
    rows = [{**POSTS[0], "stats": {"instagram": {"likes": 2}}}]

    def handler(request):
        if request.url.path.endswith("/posts"):
            return httpx.Response(200, json=rows)
        return serve(request)

    r, _ = repo(handler)
    posts, _ = r.load()
    assert posts[0].stats == {"instagram": {"likes": 2}}


def test_recent_posted_and_save_stats():
    from datetime import UTC, datetime

    def handler(request):
        if (
            request.url.path.endswith("/posts")
            and request.method == "GET"
            and "posted_at" in request.url.params
        ):
            return httpx.Response(200, json=[{**POSTS[0], "status": "posted"}])
        return serve(request)

    r, calls = repo(handler)
    r.load()
    posts = r.recent_posted(datetime(2026, 10, 23, tzinfo=UTC))
    assert [p.row for p in posts] == [12]
    q = calls[-1].url.params
    assert q["status"] == "eq.posted" and q["posted_at"] == "gte.2026-10-23T00:00:00+00:00"
    assert q["order"] == "posted_at.desc"
    r.save_stats(12, {"facebook": {"likes": 1}})
    assert calls[-1].method == "PATCH" and calls[-1].url.params["num"] == "eq.12"
    assert json.loads(calls[-1].content) == {"stats": {"facebook": {"likes": 1}}}


def test_claim_nudge_is_once_per_day():
    sent = set()

    def handler(request):
        assert request.url.path.endswith("/nudges") and request.method == "POST"
        assert request.headers["Prefer"] == "resolution=ignore-duplicates,return=representation"
        day = json.loads(request.content)["day"]
        if day in sent:
            return httpx.Response(201, json=[])  # duplicate ignored: nothing inserted
        sent.add(day)
        return httpx.Response(201, json=[{"day": day}])

    r, _ = repo(handler)
    assert r.claim_nudge(date(2026, 10, 5)) is True
    assert r.claim_nudge(date(2026, 10, 5)) is False
    assert r.claim_nudge(date(2026, 10, 6)) is True


def test_claim_nudge_error_is_a_store_error():
    r, _ = repo(lambda req: httpx.Response(500, json={"message": "boom"}))
    with pytest.raises(StoreError):
        r.claim_nudge(date(2026, 10, 5))
