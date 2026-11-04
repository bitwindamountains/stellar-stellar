import time
from collections.abc import Callable

import httpx

from postpilot import rest
from postpilot.models import PlatformError, Post, PublishResult

API = "https://api.x.com/2"
CHUNK = 4 * 1024 * 1024  # docs: segments <= 5 MB (server max 8 MB)


def classify(status: int, body: dict) -> PlatformError:
    detail = (
        body.get("detail")
        or next((e.get("message") for e in body.get("errors") or []), "")
        or f"HTTP {status}"
    )
    if status == 401:
        return PlatformError(
            "auth", f"X login expired or was revoked: reconnect X on the Accounts page ({detail})"
        )
    if status == 402:
        return PlatformError(
            "permanent", f"X API credits ran out: top up in the X developer console ({detail})"
        )
    if status == 429:
        return PlatformError("rate", f"X rate limit reached, will retry next run: {detail}")
    if status >= 500:
        return PlatformError("transient", f"X had a temporary problem: {detail}")
    return PlatformError("permanent", f"X rejected the post: {detail}")


def upload_video(
    http: httpx.Client,
    token: str,
    url: str,
    sleep: Callable[[float], None],
    seconds: float = 300,
    clock: Callable[[], float] = time.monotonic,
) -> str:
    """Chunked v2 upload; returns the media id once X finished processing it. Nothing here posts."""
    video, mime = rest.download(http, url, "X")

    def call(method: str, path: str, **kwargs) -> dict:
        # An uploaded video that never gets attached is harmless, so every upload step may retry.
        return rest.call(
            http,
            method,
            f"{API}/media/upload{path}",
            service="X",
            classify=classify,
            safe=True,
            token=token,
            **kwargs,
        ).get("data", {})

    # tweet_video = video on a regular Post; amplify_video is for Ads (docs.x.com media-upload-chunked).
    media = call(
        "POST",
        "/initialize",
        json={"total_bytes": len(video), "media_type": mime or "video/mp4", "media_category": "tweet_video"},
    )
    media_id = media["id"]
    for index, start in enumerate(range(0, len(video), CHUNK)):
        call(
            "POST",
            f"/{media_id}/append",
            data={"segment_index": index},
            files={"media": ("video", video[start : start + CHUNK], "application/octet-stream")},
            timeout=300,
        )
    info = call("POST", f"/{media_id}/finalize").get("processing_info")
    started = clock()
    while info and info.get("state") != "succeeded":
        if info.get("state") == "failed":
            reason = (info.get("error") or {}).get("message") or "no reason given"
            raise PlatformError("permanent", f"X couldn't process the video: {reason}")
        if clock() - started >= seconds:
            raise PlatformError("transient", "X is still processing the video, will retry next run")
        sleep(min(info.get("check_after_secs") or 1, 10))
        info = call("GET", "", params={"command": "STATUS", "media_id": media_id}).get("processing_info")
    return media_id


def publish(
    http: httpx.Client,
    token: str,
    post: Post,
    sleep: Callable[[float], None] = time.sleep,
    seconds: float = 300,
    clock: Callable[[], float] = time.monotonic,
) -> PublishResult:
    text = "\n\n".join(t for t in (post.text_for("x"), post.get("link")) if t)
    body: dict = {"text": text}
    if post.media_urls and post.video:
        body["media"] = {"media_ids": [upload_video(http, token, post.media_urls[0], sleep, seconds, clock)]}
    elif post.media_urls:
        image, mime = rest.download(http, post.media_urls[0], "X")
        # An uploaded image that never gets attached is harmless, so the upload may retry.
        media = rest.call(
            http,
            "POST",
            f"{API}/media/upload",
            service="X",
            classify=classify,
            safe=True,
            token=token,
            data={"media_category": "tweet_image"},
            files={"media": ("image", image, mime or "image/jpeg")},
        )
        body["media"] = {"media_ids": [media["data"]["id"]]}
    data = rest.call(
        http, "POST", f"{API}/tweets", service="X", classify=classify, safe=False, token=token, json=body
    )["data"]
    return PublishResult(data["id"], f"https://x.com/i/status/{data['id']}")
