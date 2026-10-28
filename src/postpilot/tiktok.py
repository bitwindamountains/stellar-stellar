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
    if code == "spam_risk_too_many_pending_share":
        return PlatformError("rate", "Too many TikTok drafts waiting: post or delete some in TikTok")
    if status >= 500:
        return PlatformError("transient", f"TikTok had a temporary problem: {message}")
    return PlatformError("permanent", f"TikTok rejected the post: {message} ({code or status})")


SINGLE_CHUNK_MAX = 64 * 1024 * 1024
CHUNK = 10 * 1024 * 1024


def _chunks(size: int) -> list[tuple[int, int]]:
    """TikTok's upload rules: one chunk up to 64 MB; otherwise 5-64 MB chunks, count = size // chunk,
    and the last chunk takes the remainder."""
    if size <= SINGLE_CHUNK_MAX:
        return [(0, size)]
    count = size // CHUNK
    return [(i * CHUNK, size if i == count - 1 else (i + 1) * CHUNK) for i in range(count)]


def publish(
    http: httpx.Client,
    token: str,
    post: Post,
    sleep: Callable[[float], None] = time.sleep,
    checks: int = 12,
) -> PublishResult:
    video, mime = rest.download(http, post.media_urls[0], "TikTok")
    size = len(video)
    chunks = _chunks(size)

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

    # Drafts: the video lands in your TikTok inbox and you post it from the app (no app audit needed, and
    # caption/privacy are set there). An initialised upload that never receives bytes just expires, so init
    # may retry.
    init = api(
        "post/publish/inbox/video/init/",
        safe=True,
        source_info={
            "source": "FILE_UPLOAD",
            "video_size": size,
            "chunk_size": chunks[0][1] - chunks[0][0],
            "total_chunk_count": len(chunks),
        },
    )
    publish_id = init["publish_id"]
    for start, end in chunks:
        rest.call(
            http,
            "PUT",
            init["upload_url"],
            service="TikTok",
            classify=classify,
            safe=False,  # once the bytes arrive it's in your inbox: never upload twice on an unclear answer
            content=video[start:end],
            headers={"Content-Type": mime or "video/mp4", "Content-Range": f"bytes {start}-{end - 1}/{size}"},
            timeout=300,
        )
    for check in range(checks):
        try:
            status = api("post/publish/status/fetch/", safe=True, publish_id=publish_id)
        except PlatformError:
            break  # it was uploaded: keep the ID so it is never posted twice
        if status.get("status") in ("SEND_TO_USER_INBOX", "PUBLISH_COMPLETE"):
            break
        if status.get("status") == "FAILED":
            reason = status.get("fail_reason") or "no reason given"
            raise PlatformError("permanent", f"TikTok didn't take the video: {reason}")
        if check < checks - 1:
            sleep(5)
    # Still processing after the checks is fine: TikTok finishes it on its own.
    return PublishResult(publish_id, "")
