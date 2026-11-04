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
    # By-hand text goes as a tap-to-copy block; the link belongs to Facebook, so TikTok/YouTube don't get it.
    assert calls[1] == (
        "sendMessage",
        {"chat_id": "CHAT", "text": "<b>TikTok, YouTube</b>\n<pre>Ube latte!</pre>", "parse_mode": "HTML"},
    )


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


def test_each_platform_text_in_tap_to_copy_block_with_youtube_title():
    calls = []

    def record(request):
        calls.append(json.loads(request.content))
        return ok(len(calls))

    http = httpx.Client(transport=httpx.MockTransport(record))
    variants = json.dumps({"tiktok": {"hashtags": "#fyp <3"}, "youtube": {"title": "Latte art"}})
    post = Post(row=7, cells={"caption": "Ube latte", "variants": variants})
    send_assist(http, "T", "C", post, ["tiktok", "youtube"])
    texts = [c["text"] for c in calls if "text" in c]
    assert calls[1]["parse_mode"] == "HTML"
    assert "<b>TikTok</b>" in texts[1] and "<pre>Ube latte\n\n#fyp &lt;3</pre>" in texts[1]
    assert "<b>YouTube title</b>\n<pre>Latte art</pre>" in texts[2] and "<pre>Ube latte</pre>" in texts[2]


def test_identical_texts_share_one_message():
    calls = []

    def record(request):
        calls.append(json.loads(request.content))
        return ok(len(calls))

    http = httpx.Client(transport=httpx.MockTransport(record))
    send_assist(http, "T", "C", Post(row=7, cells={"caption": "Same"}), ["tiktok", "fb_profile"])
    assert len(calls) == 2 and "<b>TikTok, Facebook (personal)</b>" in calls[1]["text"]


def test_tiktok_draft_is_labelled_and_its_video_not_resent():
    calls = []

    def record(request):
        calls.append((request.url.path.rsplit("/", 1)[-1], json.loads(request.content)))
        return ok(5)

    cells = {"caption": "Hi", "media_type": "video", "media_urls": "https://x/a.mp4", "tiktok_id": "pub_1"}
    http = httpx.Client(transport=httpx.MockTransport(record))
    send_assist(http, "BOTTOKEN", "CHAT", Post(row=7, cells=cells), ["tiktok"])
    assert [c[0] for c in calls] == ["sendMessage", "sendMessage"]  # the video is already in TikTok's inbox
    assert "TikTok (video is in your TikTok inbox)" in calls[0][1]["text"]
    assert "<pre>Hi</pre>" in calls[1][1]["text"]


def _assist_calls(**cells):
    calls = []

    def record(request):
        calls.append(json.loads(request.content))
        return ok(len(calls))

    http = httpx.Client(transport=httpx.MockTransport(record))
    post = Post(row=7, cells={"caption": "Ube latte", **cells})
    send_assist(http, "T", "C", post, ["tiktok"])
    return calls


def test_assist_sends_first_comment():
    calls = _assist_calls(first_comment="  Link in bio <3  ")
    assert calls[-1]["text"] == "<b>First comment</b>\n<pre>Link in bio &lt;3</pre>"
    assert calls[-1]["parse_mode"] == "HTML"


def test_assist_without_comment_unchanged():
    assert len(_assist_calls(first_comment="   ")) == len(_assist_calls()) == 2


def test_assist_sends_cover_after_the_video():
    calls, send = run(
        lambda r, n: ok(100 + n),
        media_type="video",
        media_urls="https://x/a.mp4",
        cover_url="https://x/c.jpg",
    )
    assert send() == "101"
    assert calls[1] == ("sendPhoto", {"chat_id": "CHAT", "photo": "https://x/c.jpg", "caption": "Cover"})


def test_cover_failure_is_ignored():
    def handler(r, n):
        if n == 2:
            return httpx.Response(400, json={"ok": False, "description": "bad"})
        return ok(100 + n)

    calls, send = run(handler, media_type="video", media_urls="https://x/a.mp4", cover_url="https://x/c.jpg")
    assert send() == "101"
    assert calls[1][0] == "sendPhoto"


def test_no_cover_no_extra_call():
    calls, send = run(lambda r, n: ok(n), media_type="video", media_urls="https://x/a.mp4")
    send()
    assert "sendPhoto" not in [c[0] for c in calls]
