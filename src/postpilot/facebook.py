import time
from collections.abc import Callable

from postpilot.graph import fetch_permalink, insight
from postpilot.models import Account, PlatformError, Post, PublishResult

REEL_STILL_PROCESSING = "Facebook accepted the Reel but was still processing; check it's on your Page"
_CHECK = "check the Reel is on your Page"


def comment(graph, post_id: str, text: str) -> str:
    # Not safe: a timeout may still have posted the comment, so it is never retried.
    return graph.post(f"{post_id}/comments", safe=False, message=text)["id"]


def publish(
    graph,
    account: Account,
    post: Post,
    sleep: Callable[[float], None] = time.sleep,
    checks: int = 60,
    download: Callable[[str], tuple[bytes, str]] | None = None,
    save_id: Callable[[str], None] | None = None,
    seconds: float = 300,
    clock: Callable[[], float] = time.monotonic,
) -> PublishResult:
    """A Reel waits up to `checks` status reads and `seconds` of wall-clock time for Facebook to finish."""
    if post.get("media_type") == "video":
        return _publish_reel(graph, account, post, sleep, checks, download, save_id, seconds, clock)
    caption, link, urls = post.text_for("facebook"), post.get("link"), post.media_urls
    if urls:
        # Photo posts have no link field, so the link goes in the caption.
        text = "\n\n".join(t for t in (caption, link) if t)
        response = graph.post(f"{account.fb_page_id}/photos", safe=False, url=urls[0], caption=text)
        post_id = response.get("post_id") or response["id"]
    else:
        fields = {"message": caption, **({"link": link} if link else {})}
        post_id = graph.post(f"{account.fb_page_id}/feed", safe=False, **fields)["id"]
    return PublishResult(post_id, fetch_permalink(graph, post_id, "permalink_url"))


def _publish_reel(graph, account, post, sleep, checks, download, save_id, seconds, clock) -> PublishResult:
    page = account.fb_page_id
    # Start and upload only stage an unpublished Reel, so they may retry; finish makes it public.
    video_id = graph.post(f"{page}/video_reels", safe=True, upload_phase="start")["video_id"]
    graph.rupload(video_id, post.media_urls[0])
    try:
        graph.post(
            f"{page}/video_reels",
            safe=False,
            upload_phase="finish",
            video_id=video_id,
            video_state="PUBLISHED",
            # Reels have no link field either, so the link goes in the description.
            description="\n\n".join(t for t in (post.text_for("facebook"), post.get("link")) if t),
        )
    except PlatformError as e:
        if e.kind == "unknown":  # it may have gone public: keep the ID so it is never sent again
            e.object_id = video_id
        raise
    except Exception as e:  # e.g. a non-JSON success body: it may have gone public
        raise PlatformError(
            "unknown", f"Unexpected {type(e).__name__} from Facebook; {_CHECK}", object_id=video_id
        ) from None
    if save_id:
        save_id(video_id)  # now, not after the wait: a run killed mid-wait must still never resend it
    try:
        return _await_reel(graph, post, video_id, sleep, checks, download, seconds, clock)
    except PlatformError as e:  # after finish, every error keeps the video ID
        e.object_id = e.object_id or video_id
        raise
    except Exception as e:  # never surface raw text: it may contain URLs with tokens
        raise PlatformError(
            "unknown",
            f"Unexpected {type(e).__name__} after Facebook accepted the Reel; {_CHECK}",
            object_id=video_id,
        ) from None


def _await_reel(graph, post, video_id, sleep, checks, download, seconds, clock) -> PublishResult:
    started = clock()
    for check in range(checks):
        try:
            state = _reel_state(graph.get(video_id, fields="status"))
        except PlatformError as e:
            if e.kind == "auth":  # waiting longer can't help: the token is gone
                raise PlatformError(
                    "unknown",
                    f"{REEL_STILL_PROCESSING} (couldn't check its status, reconnect Meta in Accounts: {e})",
                    object_id=video_id,
                ) from None
            state = None
        except Exception:  # a bad status read must never lose the video ID
            state = None
        if state == "published":
            break
        if state:
            # Keep the ID: it never goes out twice; the user's Repost clears it.
            raise PlatformError(
                "permanent", f"Facebook couldn't publish the Reel: {state}", object_id=video_id
            )
        if check == checks - 1 or clock() - started >= seconds:
            raise PlatformError("unknown", REEL_STILL_PROCESSING, object_id=video_id)
        sleep(5)
    permalink = fetch_permalink(graph, video_id, "permalink_url")
    if permalink.startswith("/"):
        permalink = "https://www.facebook.com" + permalink
    if post.get("cover_url") and download:
        try:
            content, content_type = download(post.get("cover_url"))
            graph.post(
                f"{video_id}/thumbnails",
                safe=True,
                files={"source": ("cover.jpg", content, content_type or "image/jpeg")},
                is_preferred="true",
            )
        except Exception:  # best-effort: a cover problem never fails a live Reel
            pass
    return PublishResult(video_id, permalink)


def _reel_state(response: dict) -> str | None:
    """Read a Reels status: 'published', Facebook's error reason, or None while still working."""
    status = response.get("status") or {}
    phases = [status.get(p) or {} for p in ("uploading_phase", "processing_phase", "publishing_phase")]
    failed = [p for p in phases if p.get("status") == "error"]
    if failed or status.get("video_status") in ("error", "expired", "upload_failed"):
        reason = next((p["error"].get("message") for p in phases if p.get("error")), None)
        return reason or f"status {status.get('video_status') or 'error'}"
    # Docs show both "complete" and "completed"; only a finished publishing phase counts as live.
    return "published" if phases[2].get("status") in ("complete", "completed") else None


def stats(graph, post_id: str, video: bool = False) -> dict:
    # Post metrics per Meta's deprecated-metrics page; Reel (video) metrics per the Video Insights reference.
    fields = (
        "likes.summary(total_count).limit(0),comments.summary(total_count).limit(0)"
        if video
        else "reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares"
    )
    data = graph.get(post_id, fields=fields)
    out = {
        k: data[src]["summary"]["total_count"]
        for k, src in (("likes", "likes" if video else "reactions"), ("comments", "comments"))
        if src in data
    }
    if "shares" in data:
        out["shares"] = data["shares"]["count"]
    metrics = (
        (("views", "blue_reels_play_count"), ("reach", "post_impressions_unique"))
        if video
        else (("views", "post_media_view"), ("reach", "post_total_media_view_unique"))
    )
    for key, metric in metrics:
        value = insight(graph, post_id, metric, edge="video_insights" if video else "insights")
        if value is not None:
            out[key] = value
    raw = graph.get(
        f"{post_id}/comments",
        fields="from{name},message,like_count,created_time",
        filter="toplevel",
        limit="50",
    )
    out["top_comments"] = [
        {
            "author": (c.get("from") or {}).get("name", ""),
            "text": c.get("message", ""),
            "likes": c.get("like_count", 0),
            "at": c.get("created_time", ""),
        }
        for c in raw.get("data", [])
    ]
    return out
