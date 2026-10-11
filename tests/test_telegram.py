import json

import httpx
import pytest

from postpilot.models import PlatformError, Post
from postpilot.telegram import send_assist


def run(handler, **cells):
    calls = []

    def record(request):
        calls.append((request.url.path.rsplit("/", 1)[-1], json.loads(request.content)))
        return handler(request, len(calls))

    http = httpx.Client(transport=httpx.MockTransport(record))
    post = Post(row=7, cells={"caption": "Ube latte!", **cells})
    return calls, (lambda: send_assist(http, "BOTTOKEN", "CHAT", post, ["tiktok", "youtube"]))


def ok(message_id):
    return httpx.Response(200, json={"ok": True, "result": {"message_id": message_id}})


def test_video_then_copyable_caption():
    calls, send = run(
        lambda r, n: ok(100 + n), media_type="video", media_urls="https://x/a.mp4", link="https://shop"
    )
    assert send() == "101"
    assert calls[0][0] == "sendVideo"
    assert calls[0][1]["video"] == "https://x/a.mp4"
    assert "TikTok, YouTube" in calls[0][1]["caption"] and "#7" in calls[0][1]["caption"]
    assert calls[1] == ("sendMessage", {"chat_id": "CHAT", "text": "Ube latte!\n\nhttps://shop"})


def test_media_telegram_cant_fetch_falls_back_to_link():
    def handler(r, n):
        if n == 1:
            return httpx.Response(
                400, json={"ok": False, "description": "Bad Request: failed to get HTTP URL content"}
            )
        return ok(200 + n)

    calls, send = run(handler, media_type="video", media_urls="https://x/big.mp4")
    assert send() == "202"
    assert calls[1][0] == "sendMessage" and "https://x/big.mp4" in calls[1][1]["text"]


def test_bad_token_is_auth_and_hides_token():
    calls, send = run(lambda r, n: httpx.Response(401, json={"ok": False, "description": "Unauthorized"}))
    with pytest.raises(PlatformError) as e:
        send()
    assert e.value.kind == "auth" and "BOTTOKEN" not in str(e.value)


def test_network_error_is_transient_and_hides_token():
    def boom(r, n):
        raise httpx.ConnectError(
            "cannot connect to https://api.telegram.org/botBOTTOKEN/sendMessage", request=r
        )

    _, send = run(boom)
    with pytest.raises(PlatformError) as e:
        send()
    assert e.value.kind == "transient" and "BOTTOKEN" not in str(e.value)


def test_header_links_to_app_handoff_when_given():
    calls = []

    def record(request):
        calls.append(json.loads(request.content))
        return ok(1)

    http = httpx.Client(transport=httpx.MockTransport(record))
    post = Post(row=7, cells={"caption": "x"})
    send_assist(http, "T", "C", post, ["fb_profile"], handoff_url="https://pp.example/#/handoff/7")
    assert "https://pp.example/#/handoff/7" in calls[0]["text"]
