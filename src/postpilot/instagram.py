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
    container = graph.post(
        f"{account.ig_user_id}/media",
        safe=True,
        image_url=post.media_urls[0],
        caption=post.text_for("instagram"),
    )["id"]
    for check in range(checks):
        status = graph.get(container, fields="status_code").get("status_code")
        if status == "FINISHED":
            break
        if status in ("ERROR", "EXPIRED"):
            raise PlatformError(
                "permanent",
                "Instagram couldn't use the image: check the link opens in a private window and is a JPEG",
            )
        if check < checks - 1:
            sleep(5)
    else:
        raise PlatformError("transient", "Instagram is still processing the image; will retry next run")
    media_id = graph.post(f"{account.ig_user_id}/media_publish", safe=False, creation_id=container)["id"]
    return PublishResult(media_id, fetch_permalink(graph, media_id, "permalink"))


def stats(graph, media_id: str) -> dict:
    data = graph.get(media_id, fields="like_count,comments_count")
    out = {"likes": data["like_count"], "comments": data["comments_count"]}
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
