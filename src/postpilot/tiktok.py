import time
from collections.abc import Callable

import httpx

from postpilot import rest
from postpilot.models import PlatformError, Post, PublishResult

API = "https://open.tiktokapis.com/v2"
AUTH_CODES = {"access_token_invalid", "scope_not_authorized", "scope_permission_missed"}
RATE_CODES = {"rate_limit_exceeded"}


def classify(status: int, body: dict) -> PlatformError:
    error = body.get("error") or {}
    code, message = error.get("code") or "", error.get("message") or f"HTTP {status}"
    if code in AUTH_CODES or status == 401:
        return PlatformError(
            "auth", f"TikTok login expired or lacks permission: reconnect TikTok ({message})"
        )
    if code in RATE_CODES or status == 429:
        return PlatformError("rate", f"TikTok rate limit reached, will retry next run: {message}")
    if code == "unaudited_client_can_only_post_to_private_accounts":
        return PlatformError(
            "permanent",
            "TikTok hasn't approved the app for public posts yet: set TIKTOK_PRIVACY_LEVEL=SELF_ONLY",
        )
    if status >= 500:
        return PlatformError("transient", f"TikTok had a temporary problem: {message}")
    return PlatformError("permanent", f"TikTok rejected the post: {message} ({code or status})")


def publish(
    http: httpx.Client,
    token: str,
    post: Post,
    privacy: str = "SELF_ONLY",
    sleep: Callable[[float], None] = time.sleep,
    checks: int = 12,
) -> PublishResult:
    video, mime = rest.download(http, post.media_urls[0], "TikTok")
    size = len(video)

    def api(path: str, *, safe: bool, **body) -> dict:
        return rest.call(
            http,
            "POST",
            f"{API}/{path}",
            service="TikTok",
            classify=classify,
            safe=safe,
            token=token,
            json=body,
        )["data"]

    # An initialised upload that never receives bytes just expires, so init may retry.
    init = api(
        "post/publish/video/init/",
        safe=True,
        post_info={"title": post.text_for("tiktok"), "privacy_level": privacy},
        source_info={"source": "FILE_UPLOAD", "video_size": size, "chunk_size": size, "total_chunk_count": 1},
    )
    publish_id = init["publish_id"]
    rest.call(
        http,
        "PUT",
        init["upload_url"],
        service="TikTok",
        classify=classify,
        safe=False,  # once the bytes arrive TikTok posts it: never upload twice on an unclear answer
        content=video,
        headers={"Content-Type": mime or "video/mp4", "Content-Range": f"bytes 0-{size - 1}/{size}"},
        timeout=300,
    )
    for check in range(checks):
        try:
            status = api("post/publish/status/fetch/", safe=True, publish_id=publish_id)
        except PlatformError:
            break  # it was uploaded: keep the ID so it is never posted twice
        if status.get("status") == "PUBLISH_COMPLETE":
            break
        if status.get("status") == "FAILED":
            reason = status.get("fail_reason") or "no reason given"
            raise PlatformError("permanent", f"TikTok didn't publish the video: {reason}")
        if check < checks - 1:
            sleep(5)
    # Still processing after the checks is fine: TikTok finishes it on its own.
    return PublishResult(publish_id, "")
