import json

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
    assert "status=in.%28draft%2Cscheduled%2Cpartial%2Cposting%29" in str(
        calls[1].url
    ) or "status=in.(draft,scheduled,partial,posting)" in str(calls[1].url)


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
