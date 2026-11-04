import json
from datetime import UTC, datetime

import httpx
import pytest

from postpilot import oauth, tiktok, x
from postpilot.models import PlatformError, Post

NOW = datetime(2026, 10, 28, 10, 0, tzinfo=UTC)


def fake_time():
    """A sleep that moves the clock on: a wall-clock bound ends the wait without real time passing."""
    now = [0.0]
    return {"sleep": lambda s: now.__setitem__(0, now[0] + s), "clock": lambda: now[0]}


def client(handler):
    calls = []

    def record(request: httpx.Request):
        calls.append(request)
        return handler(request)

    return httpx.Client(transport=httpx.MockTransport(record)), calls


def post(**cells):
    return Post(row=2, cells={"caption": "Hello", **cells})


# --- X ---


def test_x_text_and_link():
    http, calls = client(lambda r: httpx.Response(201, json={"data": {"id": "99", "text": "..."}}))
    result = x.publish(http, "TOK", post(link="https://example.com"))
    assert (result.id, result.permalink) == ("99", "https://x.com/i/status/99")
    assert json.loads(calls[0].content) == {"text": "Hello\n\nhttps://example.com"}
    assert calls[0].headers["Authorization"] == "Bearer TOK"


def test_x_uploads_image_then_attaches_it():
    def handler(r):
        if r.url.host == "cdn.test":
            return httpx.Response(200, content=b"jpg", headers={"content-type": "image/jpeg"})
        if r.url.path.endswith("/media/upload"):
            return httpx.Response(200, json={"data": {"id": "m1"}})
        return httpx.Response(201, json={"data": {"id": "5"}})

    http, calls = client(handler)
    x.publish(http, "TOK", post(media_type="image", media_urls="https://cdn.test/a.jpg"))
    assert [c.url.path for c in calls] == ["/a.jpg", "/2/media/upload", "/2/tweets"]
    assert json.loads(calls[-1].content)["media"] == {"media_ids": ["m1"]}


def x_video_handler(statuses, finalize_info=None):
    def handler(r):
        path = r.url.path
        if r.url.host == "cdn.test":
            return httpx.Response(200, content=b"0123456789", headers={"content-type": "video/mp4"})
        if path == "/2/media/upload/initialize":
            return httpx.Response(200, json={"data": {"id": "m9"}})
        if path.endswith("/append"):
            return httpx.Response(204)
        if path.endswith("/finalize"):
            return httpx.Response(200, json={"data": {"id": "m9", "processing_info": finalize_info}})
        if path == "/2/media/upload":
            return httpx.Response(200, json={"data": {"id": "m9", "processing_info": statuses.pop(0)}})
        return httpx.Response(201, json={"data": {"id": "7"}})

    return handler


def test_x_video_chunked_upload_then_post(monkeypatch):
    monkeypatch.setattr(x, "CHUNK", 4)
    http, calls = client(
        x_video_handler(
            [{"state": "in_progress", "check_after_secs": 30}, {"state": "succeeded"}],
            {"state": "pending", "check_after_secs": 1},
        )
    )
    naps = []
    result = x.publish(http, "TOK", post(**VIDEO), sleep=naps.append)
    assert result.permalink == "https://x.com/i/status/7"
    assert [c.url.path for c in calls[1:]] == [
        "/2/media/upload/initialize",
        *["/2/media/upload/m9/append"] * 3,  # 10 bytes in 4-byte chunks
        "/2/media/upload/m9/finalize",
        "/2/media/upload",
        "/2/media/upload",
        "/2/tweets",
    ]
    assert json.loads(calls[1].content) == {
        "total_bytes": 10,
        "media_type": "video/mp4",
        "media_category": "tweet_video",
    }
    for i in range(3):
        assert b'name="segment_index"\r\n\r\n%d' % i in calls[2 + i].content
    assert calls[-1].url.path == "/2/tweets" and json.loads(calls[-1].content)["media"] == {
        "media_ids": ["m9"]
    }
    assert calls[6].url.params["command"] == "STATUS" and calls[6].url.params["media_id"] == "m9"
    assert naps == [1, 10]  # check_after_secs honoured, capped at 10


def test_x_video_processing_failed_is_permanent_and_never_posts():
    failed = {"state": "failed", "error": {"message": "unsupported codec"}}
    http, calls = client(x_video_handler([failed], {"state": "pending"}))
    with pytest.raises(PlatformError) as e:
        x.publish(http, "TOK", post(**VIDEO), sleep=lambda s: None)
    assert e.value.kind == "permanent" and "unsupported codec" in str(e.value)
    assert all(c.url.path != "/2/tweets" for c in calls)


def test_x_video_still_processing_is_transient_and_never_posts():
    http, calls = client(x_video_handler([{"state": "in_progress"}] * 2, {"state": "pending"}))
    with pytest.raises(PlatformError) as e:
        x.publish(http, "TOK", post(**VIDEO), seconds=2, **fake_time())
    assert e.value.kind == "transient"
    assert all(c.url.path != "/2/tweets" for c in calls)


@pytest.mark.parametrize(
    ("status", "kind", "words"),
    [
        (401, "auth", "reconnect X"),
        (402, "permanent", "credits"),
        (429, "rate", "rate limit"),
        (403, "permanent", ""),
    ],
)
def test_x_errors(status, kind, words):
    http, _ = client(lambda r: httpx.Response(status, json={"detail": "nope"}))
    with pytest.raises(PlatformError) as e:
        x.publish(http, "TOK", post())
    assert e.value.kind == kind and words in str(e.value)


def test_x_unclear_answer_while_posting_is_unknown_and_not_retried():
    http, calls = client(lambda r: httpx.Response(503))
    with pytest.raises(PlatformError) as e:
        x.publish(http, "TOK", post())
    assert e.value.kind == "unknown" and len(calls) == 1


def test_x_network_error_never_leaks_the_url():
    def boom(r):
        raise httpx.ConnectError(f"failed {r.url} token=SECRET")

    http, _ = client(boom)
    with pytest.raises(PlatformError) as e:
        x.publish(http, "SECRET", post())
    assert "SECRET" not in str(e.value)


# --- TikTok ---

VIDEO = {"media_type": "video", "media_urls": "https://cdn.test/v.mp4"}


def tiktok_handler(statuses, put_status=201):
    statuses = list(statuses)

    def handler(r):
        if r.url.host == "cdn.test":
            return httpx.Response(200, content=b"0123456789", headers={"content-type": "video/mp4"})
        if r.url.host == "upload.test":
            return httpx.Response(put_status)
        if r.url.path.endswith("/init/"):
            return httpx.Response(
                200, json={"data": {"publish_id": "p1", "upload_url": "https://upload.test/u"}}
            )
        return httpx.Response(200, json={"data": {"status": statuses.pop(0)}})

    return handler


def test_tiktok_uploads_to_the_inbox_and_waits_for_it():
    http, calls = client(tiktok_handler(["PROCESSING_UPLOAD", "SEND_TO_USER_INBOX"]))
    result = tiktok.publish(http, "TOK", post(**VIDEO), sleep=lambda s: None)
    assert result.id == "p1"
    assert calls[1].url.path == "/v2/post/publish/inbox/video/init/"
    init = json.loads(calls[1].content)
    assert set(init) == {"source_info"}  # drafts carry no caption or privacy: you add those in TikTok
    assert init["source_info"]["video_size"] == 10
    assert calls[2].headers["Content-Range"] == "bytes 0-9/10"


def test_tiktok_failed_publish_is_permanent():
    http, _ = client(tiktok_handler(["FAILED"]))
    with pytest.raises(PlatformError) as e:
        tiktok.publish(http, "TOK", post(**VIDEO), sleep=lambda s: None)
    assert e.value.kind == "permanent"


def test_tiktok_unclear_upload_is_unknown():
    http, calls = client(tiktok_handler([], put_status=504))
    with pytest.raises(PlatformError) as e:
        tiktok.publish(http, "TOK", post(**VIDEO), sleep=lambda s: None)
    assert e.value.kind == "unknown"
    assert sum(c.url.host == "upload.test" for c in calls) == 1


def test_tiktok_still_processing_keeps_the_id():
    http, _ = client(tiktok_handler(["PROCESSING_UPLOAD"] * 3))
    assert tiktok.publish(http, "TOK", post(**VIDEO), sleep=lambda s: None, checks=3).id == "p1"


def test_tiktok_too_many_pending_drafts_is_retried_later():
    body = {"error": {"code": "spam_risk_too_many_pending_share", "message": "m"}}
    err = tiktok.classify(403, body)
    assert err.kind == "rate" and "drafts" in str(err)


# --- refresh ---


def test_refresh_x_rotates_tokens():
    http, calls = client(
        lambda r: httpx.Response(200, json={"access_token": "A2", "refresh_token": "R2", "expires_in": 7200})
    )
    tokens, expires = oauth.refresh(http, "x", "R1", {"X_CLIENT_ID": "cid", "X_CLIENT_SECRET": "sec"}, NOW)
    assert tokens == {"access_token": "A2", "refresh_token": "R2"}
    assert expires == "2026-10-28T12:00:00+00:00"
    assert b"refresh_token=R1" in calls[0].content
    assert calls[0].headers["Authorization"].startswith("Basic ")


def test_refresh_tiktok_keeps_refresh_token_when_not_returned():
    http, _ = client(lambda r: httpx.Response(200, json={"access_token": "A2", "expires_in": 86400}))
    env = {"TIKTOK_CLIENT_KEY": "k", "TIKTOK_CLIENT_SECRET": "s"}
    tokens, _ = oauth.refresh(http, "tiktok", "R1", env, NOW)
    assert tokens == {"access_token": "A2", "refresh_token": "R1"}


def test_refused_refresh_asks_to_reconnect():
    http, _ = client(lambda r: httpx.Response(400, json={"error": "invalid_grant"}))
    with pytest.raises(PlatformError) as e:
        oauth.refresh(http, "x", "R1", {"X_CLIENT_ID": "cid"}, NOW)
    assert e.value.kind == "auth" and "reconnect" in str(e.value)


def test_needs_refresh():
    assert not oauth.needs_refresh("", NOW)
    assert oauth.needs_refresh("2026-10-28T10:04:00+00:00", NOW)
    assert oauth.needs_refresh("2026-10-28T10:14:00+00:00", NOW)  # would expire during the run
    assert not oauth.needs_refresh("2026-10-28T11:00:00+00:00", NOW)


@pytest.mark.parametrize(
    ("status", "kind"), [(429, "rate"), (408, "transient"), (503, "transient"), (400, "auth")]
)
def test_refresh_errors(status, kind):
    http, calls = client(lambda r: httpx.Response(status, json={}))
    with pytest.raises(PlatformError) as e:
        oauth.refresh(http, "x", "R1", {"X_CLIENT_ID": "cid"}, NOW)
    assert e.value.kind == kind
    assert len(calls) == 1  # never resent: X may already have rotated the refresh token


def test_tiktok_chunks_follow_tiktok_rules():
    assert tiktok._chunks(10) == [(0, 10)]
    assert tiktok._chunks(64 * 2**20) == [(0, 64 * 2**20)]
    size = 105 * 2**20 + 123
    chunks = tiktok._chunks(size)
    assert len(chunks) == size // tiktok.CHUNK == 10
    assert chunks[0] == (0, tiktok.CHUNK) and chunks[-1][1] == size
    assert all(a[1] == b[0] for a, b in zip(chunks, chunks[1:], strict=False))
    assert chunks[-1][1] - chunks[-1][0] < 128 * 2**20


def test_tiktok_big_video_uploads_every_chunk(monkeypatch):
    monkeypatch.setattr(tiktok, "SINGLE_CHUNK_MAX", 4)
    monkeypatch.setattr(tiktok, "CHUNK", 4)
    http, calls = client(tiktok_handler(["PUBLISH_COMPLETE"]))
    tiktok.publish(http, "TOK", post(**VIDEO), sleep=lambda s: None)
    init = json.loads(calls[1].content)["source_info"]
    assert (init["chunk_size"], init["total_chunk_count"]) == (4, 2)
    puts = [c.headers["Content-Range"] for c in calls if c.url.host == "upload.test"]
    assert puts == ["bytes 0-3/10", "bytes 4-9/10"]


def test_x_video_poll_stops_at_its_time_bound():
    http, calls = client(x_video_handler([{"state": "in_progress"}] * 5, {"state": "pending"}))
    ticks = iter([0, 100, 400])  # start, before the 1st status poll, before the 2nd
    with pytest.raises(PlatformError) as e:
        x.publish(http, "TOK", post(**VIDEO), sleep=lambda s: None, seconds=300, clock=lambda: next(ticks))
    assert e.value.kind == "transient"
    assert [c.url.path for c in calls].count("/2/media/upload") == 1
