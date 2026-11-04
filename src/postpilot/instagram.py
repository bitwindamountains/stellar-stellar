import time
from collections.abc import Callable

from postpilot.graph import fetch_permalink, insight
from postpilot.models import Account, PlatformError, Post, PublishResult


def comment(graph, media_id: str, text: str) -> str:
    # Not safe: a timeout may still have posted the comment, so it is never retried.
    return graph.post(f"{media_id}/comments", safe=False, message=text)["id"]


def publish(
    graph, account: Account, post: Post, sleep: Callable[[float], None] = time.sleep, checks: int = 12
) -> PublishResult:
    # An unpublished container is harmless if duplicated, so this call may retry.
    video = post.get("media_type") == "video"
    if video:
        fields = {"media_type": "REELS", "video_url": post.media_urls[0], "share_to_feed": "true"}
        if post.get("cover_url"):
            fields["cover_url"] = post.get("cover_url")
        what, hint = (
            "video",
            "check the link opens in a private window and is an MP4 (H.264/AAC) up to 90 seconds",
        )
    else:
        fields = {"image_url": post.media_urls[0]}
        what, hint = "image", "check the link opens in a private window and is a JPEG"
    container = graph.post(
        f"{account.ig_user_id}/media", safe=True, caption=post.text_for("instagram"), **fields
    )["id"]
    for check in range(checks):
        status = graph.get(container, fields="status_code").get("status_code")
        if status == "FINISHED":
            break
        if status in ("ERROR", "EXPIRED"):
            raise PlatformError("permanent", f"Instagram couldn't use the {what}: {hint}")
        if check < checks - 1:
            sleep(5)
    else:
        raise PlatformError("transient", f"Instagram is still processing the {what}; will retry next run")
    media_id = graph.post(f"{account.ig_user_id}/media_publish", safe=False, creation_id=container)["id"]
    return PublishResult(media_id, fetch_permalink(graph, media_id, "permalink"))


def stats(graph, media_id: str) -> dict:
    data = graph.get(media_id, fields="like_count,comments_count")
    # Instagram omits like_count when the owner hides likes.
    out = {
        k: data[src] for k, src in (("likes", "like_count"), ("comments", "comments_count")) if src in data
    }
    for key in ("reach", "views"):
        value = insight(graph, media_id, key)
        if value is not None:
            out[key] = value
    raw = graph.get(f"{media_id}/comments", fields="text,username,like_count,timestamp", limit="50")
    out["top_comments"] = [
        {
            "author": c.get("username", ""),
            "text": c.get("text", ""),
            "likes": c.get("like_count", 0),
            "at": c.get("timestamp", ""),
        }
        for c in raw.get("data", [])
    ]
    return out
