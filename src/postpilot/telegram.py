import httpx

from postpilot.models import PlatformError, Post

API = "https://api.telegram.org"
NAMES = {"fb_profile": "Facebook (personal)", "tiktok": "TikTok", "youtube": "YouTube"}


def send_assist(http: httpx.Client, token: str, chat_id: str, post: Post, platforms: list[str]) -> str:
    """Send media + a copy-ready caption for manual posting. Returns the first message's id."""
    header = f"Post now to {', '.join(NAMES.get(p, p) for p in platforms)} (sheet row {post.row})"
    first_id = None
    if post.media_urls:
        url = post.media_urls[0]
        method, field = (
            ("sendVideo", "video") if post.get("media_type").lower() == "video" else ("sendPhoto", "photo")
        )
        try:
            first_id = _call(http, token, method, chat_id=chat_id, caption=header, **{field: url})
        except PlatformError as e:
            if e.kind != "permanent":
                raise
            # Telegram fetches by URL only up to ~20 MB (5 MB for photos); send the link instead.
            header += f"\nMedia (too big or unreachable for Telegram, download it here): {url}"
    if first_id is None:
        first_id = _call(http, token, "sendMessage", chat_id=chat_id, text=header)
    text = "\n\n".join(t for t in (post.get("caption"), post.get("link")) if t)
    if text:
        _call(http, token, "sendMessage", chat_id=chat_id, text=text)
    return first_id


def _call(http: httpx.Client, token: str, method: str, **params: str) -> str:
    # The token is part of the URL, so httpx error text is never passed on.
    try:
        response = http.post(f"{API}/bot{token}/{method}", json=params, timeout=60)
    except httpx.TransportError:
        raise PlatformError("transient", "Couldn't reach Telegram (network problem)") from None
    try:
        body = response.json()
    except ValueError:
        body = {}
    if response.is_success and body.get("ok"):
        return str(body["result"]["message_id"])
    description = body.get("description") or f"HTTP {response.status_code}"
    if response.status_code in (401, 404):
        raise PlatformError("auth", "Telegram bot token is wrong or revoked: check TELEGRAM_BOT_TOKEN")
    if response.status_code == 429:
        raise PlatformError("rate", f"Telegram rate limit: {description}")
    if response.status_code >= 500:
        raise PlatformError("transient", f"Telegram had a temporary problem: {description}")
    raise PlatformError("permanent", f"Telegram refused the message: {description}")
