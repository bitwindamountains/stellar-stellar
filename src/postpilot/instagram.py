import time
from collections.abc import Callable

from postpilot.graph import fetch_permalink
from postpilot.models import Account, PlatformError, Post, PublishResult


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
