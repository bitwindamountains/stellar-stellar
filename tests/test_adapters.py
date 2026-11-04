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

    def rupload(self, video_id, file_url):
        return self._next(("RUPLOAD", video_id, file_url))


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


def reel(**cells):
    return post(media_type="video", media_urls="https://x/clip.mp4", **cells)


def status(video="processing", publishing="not_started", processing="in_progress", error=None):
    phase = {"status": processing, **({"error": {"message": error}} if error else {})}
    return {
        "status": {
            "video_status": video,
            "uploading_phase": {"status": "complete"},
            "processing_phase": phase,
            "publishing_phase": {"status": publishing, "publish_status": "published"},
        }
    }


REEL_START = [{"video_id": "V1", "upload_url": "https://rupload/V1"}, {"success": True}, {"success": True}]
PUBLISHED = status("ready", publishing="complete", processing="complete")


def test_fb_reel_start_upload_finish_wait_permalink():
    g = FakeGraph(REEL_START + [status(), PUBLISHED, {"permalink_url": "/reel/V1"}])
    sleeps = []
    result = facebook.publish(
        g, ACCOUNT, reel(variants='{"facebook": {"hashtags": "#fb"}}'), sleep=sleeps.append
    )
    assert g.calls == [
        ("POST", "PAGE/video_reels", {"upload_phase": "start"}, True),
        ("RUPLOAD", "V1", "https://x/clip.mp4"),
        (
            "POST",
            "PAGE/video_reels",
            {
                "upload_phase": "finish",
                "video_id": "V1",
                "video_state": "PUBLISHED",
                "description": "Hello\n\n#fb",
            },
            False,
        ),
        ("GET", "V1", {"fields": "status"}),
        ("GET", "V1", {"fields": "status"}),
        ("GET", "V1", {"fields": "permalink_url"}),
    ]
    assert sleeps == [5]
    assert (result.id, result.permalink) == ("V1", "https://www.facebook.com/reel/V1")


def test_fb_reel_processing_error_is_permanent_and_keeps_id():
    g = FakeGraph(REEL_START + [status("error", processing="error", error="Resolution too low.")])
    with pytest.raises(PlatformError) as e:
        facebook.publish(g, ACCOUNT, reel(), sleep=lambda s: None)
    assert e.value.kind == "permanent" and e.value.object_id == "V1"
    assert "Resolution too low." in str(e.value)


def test_fb_reel_null_permalink_keeps_id():
    g = FakeGraph(REEL_START + [PUBLISHED, {"permalink_url": None}])
    result = facebook.publish(g, ACCOUNT, reel(), sleep=lambda s: None)
    assert (result.id, result.permalink) == ("V1", "")


def test_fb_reel_still_processing_is_unknown_with_id():
    g = FakeGraph(REEL_START + [status()] * 3)
    with pytest.raises(PlatformError) as e:
        facebook.publish(g, ACCOUNT, reel(), sleep=lambda s: None, checks=3)
    assert e.value.kind == "unknown" and e.value.object_id == "V1"
    assert "check it's on your Page" in str(e.value)


def test_fb_reel_status_read_failure_keeps_waiting_and_keeps_id():
    g = FakeGraph(REEL_START + [PlatformError("transient", "down"), PUBLISHED, {"permalink_url": ""}])
    assert facebook.publish(g, ACCOUNT, reel(), sleep=lambda s: None).id == "V1"
    g = FakeGraph(REEL_START + [PlatformError("auth", "x")] * 2)
    with pytest.raises(PlatformError) as e:
        facebook.publish(g, ACCOUNT, reel(), sleep=lambda s: None, checks=2)
    assert e.value.kind == "unknown" and e.value.object_id == "V1"


def test_fb_reel_finish_unclear_is_unknown():
    g = FakeGraph(REEL_START[:2] + [PlatformError("unknown", "no answer")])
    with pytest.raises(PlatformError) as e:
        facebook.publish(g, ACCOUNT, reel(), sleep=lambda s: None)
    assert e.value.kind == "unknown" and e.value.object_id == "V1"
    assert all(c[0] != "GET" for c in g.calls)


def test_fb_reel_finish_rejected_is_permanent_without_id():
    g = FakeGraph(REEL_START[:2] + [PlatformError("permanent", "too long")])
    with pytest.raises(PlatformError) as e:
        facebook.publish(g, ACCOUNT, reel(), sleep=lambda s: None)
    assert e.value.kind == "permanent" and e.value.object_id == ""


def test_fb_reel_sets_cover_as_preferred_thumbnail():
    g = FakeGraph(REEL_START + [PUBLISHED, {"permalink_url": "https://fb/r"}, {"success": True}])
    got = []
    download = lambda u: got.append(u) or (b"JPG", "image/jpeg")  # noqa: E731
    result = facebook.publish(
        g, ACCOUNT, reel(cover_url="https://x/c.jpg"), sleep=lambda s: None, download=download
    )
    assert got == ["https://x/c.jpg"]
    assert g.calls[-1] == (
        "POST",
        "V1/thumbnails",
        {"files": {"source": ("cover.jpg", b"JPG", "image/jpeg")}, "is_preferred": "true"},
        True,
    )
    assert result.permalink == "https://fb/r"


def test_fb_reel_cover_failure_is_ignored():
    g = FakeGraph(REEL_START + [PUBLISHED, {"permalink_url": ""}, PlatformError("auth", "no perm")])
    result = facebook.publish(
        g, ACCOUNT, reel(cover_url="https://x/c.jpg"), sleep=lambda s: None, download=lambda u: (b"J", "")
    )
    assert result.id == "V1"

    def broken(url):
        raise PlatformError("permanent", "Media link answered HTTP 404")

    g = FakeGraph(REEL_START + [PUBLISHED, {"permalink_url": ""}])
    result = facebook.publish(
        g, ACCOUNT, reel(cover_url="https://x/c.jpg"), sleep=lambda s: None, download=broken
    )
    assert result.id == "V1"


def test_fb_reel_without_download_skips_cover():
    g = FakeGraph(REEL_START + [PUBLISHED, {"permalink_url": ""}])
    facebook.publish(g, ACCOUNT, reel(cover_url="https://x/c.jpg"), sleep=lambda s: None)
    assert all("thumbnails" not in str(c[1]) for c in g.calls)


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


def test_ig_reel_container_fields():
    for cells, extra in (({}, {}), ({"cover_url": "https://x/c.jpg"}, {"cover_url": "https://x/c.jpg"})):
        g = FakeGraph([{"id": "C1"}, {"status_code": "FINISHED"}, {"id": "M1"}, {"permalink": ""}])
        instagram.publish(g, ACCOUNT, reel(**cells), sleep=lambda s: None)
        fields = {
            "media_type": "REELS",
            "video_url": "https://x/clip.mp4",
            "share_to_feed": "true",
            "caption": "Hello",
            **extra,
        }
        assert g.calls[0] == ("POST", "IGUSER/media", fields, True)


def test_ig_reel_error_message_mentions_the_video():
    g = FakeGraph([{"id": "C1"}, {"status_code": "ERROR"}])
    with pytest.raises(PlatformError) as e:
        instagram.publish(g, ACCOUNT, reel(), sleep=lambda s: None)
    assert e.value.kind == "permanent"
    assert str(e.value).startswith("Instagram couldn't use the video: ")
    assert "JPEG" not in str(e.value)


def test_ig_reel_still_processing_is_transient():
    g = FakeGraph([{"id": "C1"}] + [{"status_code": "IN_PROGRESS"}] * 3)
    with pytest.raises(PlatformError) as e:
        instagram.publish(g, ACCOUNT, reel(), sleep=lambda s: None, checks=3)
    assert e.value.kind == "transient"
    assert all(c[1] != "IGUSER/media_publish" for c in g.calls)


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


def _routed(routes):
    """FakeGraph-free: route by (path, metric) -> dict or PlatformError."""

    class G:
        def get(self, path, **params):
            r = routes[(path, params.get("metric"))]
            if isinstance(r, Exception):
                raise r
            return r

    return G()


def _ig_routes():
    ins = lambda n, v: {"data": [{"name": n, "values": [{"value": v}]}]}  # noqa: E731
    return {
        ("M", None): {"like_count": 5, "comments_count": 2},
        ("M/insights", "reach"): ins("reach", 100),
        ("M/insights", "views"): ins("views", 150),
        ("M/comments", None): {
            "data": [
                {"text": "nice", "username": "bob", "like_count": 3, "timestamp": "2026-01-01T00:00:00+0000"}
            ]
        },
    }


IG_COMMENT = {"author": "bob", "text": "nice", "likes": 3, "at": "2026-01-01T00:00:00+0000"}


def test_ig_stats_happy_path():
    assert instagram.stats(_routed(_ig_routes()), "M") == {
        "likes": 5, "comments": 2, "reach": 100, "views": 150, "top_comments": [IG_COMMENT],
    }  # fmt: skip


def test_ig_stats_retired_metric_only_loses_itself():
    routes = _ig_routes()
    routes[("M/insights", "views")] = PlatformError("permanent", "Meta rejected the post: x (code 100)")
    out = instagram.stats(_routed(routes), "M")
    assert "views" not in out and out["reach"] == 100 and out["likes"] == 5 and out["top_comments"]


def _fb_routes(shares=True):
    ins = lambda n, v: {"data": [{"name": n, "values": [{"value": v}]}]}  # noqa: E731
    post_fields = {
        "reactions": {"data": [], "summary": {"total_count": 7}},
        "comments": {"data": [], "summary": {"total_count": 1}},
    }
    if shares:
        post_fields["shares"] = {"count": 4}
    return {
        ("P", None): post_fields,
        ("P/insights", "post_media_view"): ins("post_media_view", 90),
        ("P/insights", "post_total_media_view_unique"): ins("post_total_media_view_unique", 60),
        ("P/comments", None): {
            "data": [{"from": {"name": "Ann"}, "message": "hi", "like_count": 1, "created_time": "T"}]
        },
    }


def test_fb_stats_happy_path_and_no_shares_key_when_absent():
    out = facebook.stats(_routed(_fb_routes()), "P")
    assert out == {
        "likes": 7, "comments": 1, "shares": 4, "views": 90, "reach": 60,
        "top_comments": [{"author": "Ann", "text": "hi", "likes": 1, "at": "T"}],
    }  # fmt: skip
    assert "shares" not in facebook.stats(_routed(_fb_routes(shares=False)), "P")


def test_stats_fields_error_propagates():
    routes = _ig_routes()
    routes[("M", None)] = PlatformError("auth", "x")
    with pytest.raises(PlatformError):
        instagram.stats(_routed(routes), "M")


# --- real GraphClient + MockTransport: asserts the exact request params -------------------------


def _client(routes):
    """routes: {(path, metric|None): json | status-400 marker}. Returns (client, requests)."""
    import httpx

    from postpilot.graph import GraphClient

    seen = []

    def handler(r):
        seen.append(r)
        key = (r.url.path.split("/", 2)[2], r.url.params.get("metric"))
        body = routes[key]
        if body == "ERR":
            return httpx.Response(400, json={"error": {"code": 100, "message": "bad metric"}})
        return httpx.Response(200, json=body)

    return GraphClient(
        "v1", "T", http=httpx.Client(transport=httpx.MockTransport(handler)), sleep=lambda s: None
    ), seen


def _params(seen, path, metric=None):
    (r,) = [r for r in seen if r.url.path.endswith("/" + path) and r.url.params.get("metric") == metric]
    return dict(r.url.params)


def _ins(name, value):
    return {"data": [{"name": name, "values": [{"value": value}]}]}


def test_ig_stats_sends_exact_graph_params():
    g, seen = _client(_ig_routes())
    instagram.stats(g, "M")
    assert _params(seen, "M")["fields"] == "like_count,comments_count"
    assert _params(seen, "M/insights", "reach") == {"metric": "reach"}
    assert _params(seen, "M/insights", "views") == {"metric": "views"}
    assert _params(seen, "M/comments") == {"fields": "text,username,like_count,timestamp", "limit": "50"}


def test_fb_stats_sends_exact_graph_params():
    g, seen = _client(_fb_routes())
    facebook.stats(g, "P")
    assert _params(seen, "P")["fields"] == (
        "reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares"
    )
    assert _params(seen, "P/insights", "post_media_view") == {"metric": "post_media_view"}
    assert _params(seen, "P/insights", "post_total_media_view_unique") == {
        "metric": "post_total_media_view_unique"
    }
    assert _params(seen, "P/comments") == {
        "fields": "from{name},message,like_count,created_time",
        "filter": "toplevel",
        "limit": "50",
    }


def test_ig_stats_hidden_like_count_drops_only_likes():
    routes = _ig_routes()
    routes[("M", None)] = {"comments_count": 2}
    g, _ = _client(routes)
    out = instagram.stats(g, "M")
    assert "likes" not in out and out["comments"] == 2 and out["reach"] == 100 and out["top_comments"]


def test_fb_stats_missing_reactions_drops_only_likes():
    routes = _fb_routes()
    del routes[("P", None)]["reactions"]
    g, _ = _client(routes)
    out = facebook.stats(g, "P")
    assert "likes" not in out and out["comments"] == 1 and out["shares"] == 4 and out["views"] == 90


def test_fb_stats_one_insight_error_loses_only_that_key():
    routes = _fb_routes()
    routes[("P/insights", "post_total_media_view_unique")] = "ERR"
    g, _ = _client(routes)
    out = facebook.stats(g, "P")
    assert "reach" not in out and out["views"] == 90 and out["likes"] == 7 and out["top_comments"]


def test_fb_stats_comments_error_propagates():
    routes = _fb_routes()
    routes[("P/comments", None)] = "ERR"
    g, _ = _client(routes)
    with pytest.raises(PlatformError):
        facebook.stats(g, "P")


def test_fb_reel_stats_use_video_fields_and_reel_insights():
    routes = {
        ("V", None): {
            "likes": {"data": [], "summary": {"total_count": 3}},
            "comments": {"data": [], "summary": {"total_count": 2}},
        },
        ("V/video_insights", "blue_reels_play_count"): _ins("blue_reels_play_count", 40),
        ("V/video_insights", "post_impressions_unique"): _ins("post_impressions_unique", 30),
        ("V/comments", None): {"data": []},
    }
    g, seen = _client(routes)
    out = facebook.stats(g, "V", video=True)
    assert _params(seen, "V")["fields"] == (
        "likes.summary(total_count).limit(0),comments.summary(total_count).limit(0)"
    )
    assert out == {"likes": 3, "comments": 2, "views": 40, "reach": 30, "top_comments": []}
