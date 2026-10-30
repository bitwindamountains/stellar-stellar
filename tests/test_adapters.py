import pytest

from postpilot import facebook, instagram
from postpilot.models import Account, PlatformError, Post

ACCOUNT = Account("main", "PAGE", "IGUSER", "T", "Asia/Manila")


class FakeGraph:
    def __init__(self, responses):
        self.responses = list(responses)  # each: dict or PlatformError
        self.calls = []

    def _next(self, call):
        self.calls.append(call)
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r

    def get(self, path, **params):
        return self._next(("GET", path, params))

    def post(self, path, *, safe, **data):
        return self._next(("POST", path, data, safe))


def post(**cells):
    return Post(row=2, cells={"caption": "Hello", **cells})


def test_fb_text_with_link():
    g = FakeGraph([{"id": "PAGE_1"}, {"permalink_url": "https://fb/1"}])
    result = facebook.publish(g, ACCOUNT, post(link="https://shop"))
    assert g.calls[0] == ("POST", "PAGE/feed", {"message": "Hello", "link": "https://shop"}, False)
    assert g.calls[1] == ("GET", "PAGE_1", {"fields": "permalink_url"})
    assert (result.id, result.permalink) == ("PAGE_1", "https://fb/1")


def test_fb_photo_puts_link_in_caption_and_uses_post_id():
    g = FakeGraph([{"id": "PHOTO", "post_id": "PAGE_2"}, {"permalink_url": "https://fb/2"}])
    result = facebook.publish(
        g, ACCOUNT, post(media_type="image", media_urls="https://x/a.jpg", link="https://shop")
    )
    assert g.calls[0] == (
        "POST",
        "PAGE/photos",
        {"url": "https://x/a.jpg", "caption": "Hello\n\nhttps://shop"},
        False,
    )
    assert result.id == "PAGE_2"


def test_fb_permalink_failure_keeps_post_id():
    g = FakeGraph([{"id": "PAGE_1"}, PlatformError("transient", "down")])
    assert facebook.publish(g, ACCOUNT, post()).id == "PAGE_1"


def test_ig_container_wait_publish_permalink():
    g = FakeGraph(
        [
            {"id": "C1"},
            {"status_code": "IN_PROGRESS"},
            {"status_code": "FINISHED"},
            {"id": "M1"},
            {"permalink": "https://ig/p/1"},
        ]
    )
    result = instagram.publish(
        g, ACCOUNT, post(media_type="image", media_urls="https://x/a.jpg"), sleep=lambda s: None
    )
    assert g.calls[0] == ("POST", "IGUSER/media", {"image_url": "https://x/a.jpg", "caption": "Hello"}, True)
    assert g.calls[3] == ("POST", "IGUSER/media_publish", {"creation_id": "C1"}, False)
    assert (result.id, result.permalink) == ("M1", "https://ig/p/1")


def test_ig_container_error_is_permanent_and_never_publishes():
    g = FakeGraph([{"id": "C1"}, {"status_code": "ERROR"}])
    with pytest.raises(PlatformError) as e:
        instagram.publish(
            g, ACCOUNT, post(media_type="image", media_urls="https://x/a.jpg"), sleep=lambda s: None
        )
    assert e.value.kind == "permanent" and "image" in str(e.value)
    assert all(c[1] != "IGUSER/media_publish" for c in g.calls)


def test_ig_still_processing_is_transient():
    g = FakeGraph([{"id": "C1"}] + [{"status_code": "IN_PROGRESS"}] * 3)
    with pytest.raises(PlatformError) as e:
        instagram.publish(
            g, ACCOUNT, post(media_type="image", media_urls="https://x/a.jpg"), sleep=lambda s: None, checks=3
        )
    assert e.value.kind == "transient"


def test_fb_and_ig_use_their_own_text():
    import json as _json

    variants = _json.dumps({"facebook": {"hashtags": "#fb"}, "instagram": {"caption": "IG only"}})
    g = FakeGraph([{"id": "PAGE_1"}, {"permalink_url": ""}])
    facebook.publish(g, ACCOUNT, post(variants=variants))
    assert g.calls[0][2]["message"] == "Hello\n\n#fb"
    g = FakeGraph([{"id": "C1"}, {"status_code": "FINISHED"}, {"id": "M1"}, {"permalink": ""}])
    instagram.publish(
        g,
        ACCOUNT,
        post(variants=variants, media_type="image", media_urls="https://x/a.jpg"),
        sleep=lambda s: None,
    )
    assert g.calls[0][2]["caption"] == "IG only"


def test_comment_posts_to_comments_edge_and_returns_id():
    g = FakeGraph([{"id": "C1"}, {"id": "C2"}])
    assert facebook.comment(g, "PAGE_1", "hi") == "C1"
    assert instagram.comment(g, "MEDIA", "hi") == "C2"
    assert g.calls == [
        ("POST", "PAGE_1/comments", {"message": "hi"}, False),
        ("POST", "MEDIA/comments", {"message": "hi"}, False),
    ]


def test_comment_timeout_is_unknown_not_retried():
    import httpx

    from postpilot.graph import GraphClient

    calls = []

    def boom(r):
        calls.append(r)
        raise httpx.ReadTimeout("timed out", request=r)

    g = GraphClient("v1", "T", http=httpx.Client(transport=httpx.MockTransport(boom)), sleep=lambda s: None)
    with pytest.raises(PlatformError) as e:
        instagram.comment(g, "MEDIA", "hi")
    assert e.value.kind == "unknown" and len(calls) == 1
    assert calls[0].url.path.endswith("/MEDIA/comments") and b"message=hi" in calls[0].content
