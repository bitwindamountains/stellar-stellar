import httpx
import pytest

from postpilot.graph import GraphClient
from postpilot.models import PlatformError


def client(handler, attempts=3):
    calls = []

    def record(request):
        calls.append(request)
        return handler(request, len(calls))

    g = GraphClient(
        "v23.0",
        "TOKEN",
        http=httpx.Client(transport=httpx.MockTransport(record)),
        sleep=lambda s: None,
        attempts=attempts,
    )
    return g, calls


def err(status, code, message="boom", subcode=None):
    body = {"error": {"code": code, "message": message}}
    if subcode:
        body["error"]["error_subcode"] = subcode
    return httpx.Response(status, json=body)


def test_get_sends_token_in_header_not_url():
    g, calls = client(lambda r, n: httpx.Response(200, json={"id": "1"}))
    assert g.get("123", fields="permalink_url") == {"id": "1"}
    assert calls[0].headers["Authorization"] == "Bearer TOKEN"
    assert "TOKEN" not in str(calls[0].url)
    assert str(calls[0].url) == "https://graph.facebook.com/v23.0/123?fields=permalink_url"


def test_post_sends_form_data():
    g, calls = client(lambda r, n: httpx.Response(200, json={"id": "9"}))
    g.post("PAGE/feed", safe=False, message="hi")
    assert calls[0].method == "POST" and calls[0].content == b"message=hi"


@pytest.mark.parametrize(
    ("status", "code", "subcode", "kind"),
    [
        (400, 190, None, "auth"),
        (403, 10, None, "auth"),
        (403, 200, None, "auth"),
        (400, 4, None, "rate"),
        (400, 613, None, "rate"),
        (400, 9, 2207042, "rate"),
        (400, 100, None, "permanent"),
        (400, 368, None, "permanent"),
    ],
)
def test_classification(status, code, subcode, kind):
    g, calls = client(lambda r, n: err(status, code, subcode=subcode))
    with pytest.raises(PlatformError) as e:
        g.get("x")
    assert e.value.kind == kind
    assert len(calls) == 1


def test_safe_calls_retry_transient_then_succeed():
    g, calls = client(lambda r, n: err(500, 2) if n < 3 else httpx.Response(200, json={"ok": 1}))
    assert g.get("x") == {"ok": 1}
    assert len(calls) == 3


def test_safe_calls_give_up_as_transient():
    g, calls = client(lambda r, n: httpx.Response(503, text="down"))
    with pytest.raises(PlatformError) as e:
        g.get("x")
    assert e.value.kind == "transient" and len(calls) == 3


def test_unsafe_call_never_retried_and_marked_unknown():
    g, calls = client(lambda r, n: httpx.Response(502, text="bad gateway"))
    with pytest.raises(PlatformError) as e:
        g.post("PAGE/feed", safe=False, message="hi")
    assert e.value.kind == "unknown" and len(calls) == 1
    assert "check" in str(e.value)


def test_unsafe_timeout_is_unknown_and_hides_url():
    def boom(r, n):
        raise httpx.ReadTimeout("timed out https://graph.facebook.com/?access_token=TOKEN", request=r)

    g, calls = client(boom)
    with pytest.raises(PlatformError) as e:
        g.post("PAGE/feed", safe=False, message="hi")
    assert e.value.kind == "unknown" and "TOKEN" not in str(e.value)


def test_auth_message_is_plain_language():
    g, _ = client(lambda r, n: err(400, 190, "Error validating access token"))
    with pytest.raises(PlatformError, match="token"):
        g.get("x")


def test_rupload_sends_file_url_header_to_rupload_host():
    g, calls = client(lambda r, n: httpx.Response(200, json={"success": True}))
    assert g.rupload("V1", "https://cdn.example/clip.mp4") == {"success": True}
    r = calls[0]
    assert r.url.host == "rupload.facebook.com" and r.url.path == "/video-upload/v23.0/V1"
    assert r.headers["file_url"] == "https://cdn.example/clip.mp4"
    assert r.headers["Authorization"] == "OAuth TOKEN"
    assert "TOKEN" not in str(r.url)


def test_rupload_500_is_retried_then_transient():
    g, calls = client(lambda r, n: httpx.Response(500, text="down"))
    with pytest.raises(PlatformError) as e:
        g.rupload("V1", "https://cdn.example/clip.mp4")
    assert e.value.kind == "transient" and len(calls) == 3


def test_post_with_files_sends_multipart():
    g, calls = client(lambda r, n: httpx.Response(200, json={"id": "9"}))
    g.post("V1", safe=False, files={"thumb": ("c.jpg", b"JPEGDATA", "image/jpeg")}, title="t")
    r = calls[0]
    assert r.headers["content-type"].startswith("multipart/form-data")
    assert b"JPEGDATA" in r.content and b'name="title"' in r.content
