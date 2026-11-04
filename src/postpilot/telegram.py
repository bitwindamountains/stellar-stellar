from html import escape

import httpx

from postpilot.models import ID_COLUMN, SENT_BY_HAND, PlatformError, Post

API = "https://api.telegram.org"
NAMES = {"fb_profile": "Facebook (personal)", "tiktok": "TikTok", "youtube": "YouTube", "shopee": "Shopee"}


def send_assist(
    http: httpx.Client, token: str, chat_id: str, post: Post, platforms: list[str], handoff_url: str = ""
) -> str:
    """Send media + a copy-ready caption for manual posting. Returns the first message's id."""
    drafts = [p for p in platforms if p in ID_COLUMN and post.get(ID_COLUMN[p]) not in ("", SENT_BY_HAND)]
    names = [
        f"{NAMES.get(p, p)} (video is in your {NAMES.get(p, p)} inbox)" if p in drafts else NAMES.get(p, p)
        for p in platforms
    ]
    header = f"Post now to {', '.join(names)} (post #{post.row})"
    if handoff_url:
        header += f"\nOpen in PostPilot: {handoff_url}"
    first_id = None
    if post.media_urls and len(drafts) < len(platforms):  # a draft already has its video
        url = post.media_urls[0]
        method, field = (
            ("sendVideo", "video") if post.get("media_type").lower() == "video" else ("sendPhoto", "photo")
        )
        try:
            first_id = _call(http, token, method, chat_id=chat_id, caption=header, **{field: url})[
                "message_id"
            ]
            if method == "sendVideo" and (cover := post.get("cover_url")):
                try:
                    _call(http, token, "sendPhoto", chat_id=chat_id, photo=cover, caption="Cover")
                except PlatformError:
                    pass  # the cover is a nicety; never fail the handoff over it
        except PlatformError as e:
            if e.kind != "permanent":
                raise
            # Telegram fetches by URL only up to ~20 MB (5 MB for photos); send the link instead.
            header += f"\nMedia (too big or unreachable for Telegram, download it here): {url}"
    if first_id is None:
        first_id = _call(http, token, "sendMessage", chat_id=chat_id, text=header)["message_id"]
    # One message per distinct text; <pre> blocks copy with a single tap in Telegram.
    groups: dict[tuple[str, str], list[str]] = {}
    for p in platforms:
        text = post.text_for(p)
        if p == "fb_profile" and post.get("link"):
            text = "\n\n".join(t for t in (text, post.get("link")) if t)
        groups.setdefault((text, post.title_for(p)), []).append(p)
    for (text, title), names in groups.items():
        parts = [f"<b>{escape(', '.join(NAMES.get(p, p) for p in names))}</b>"]
        if title:
            parts.append(f"<b>{escape(NAMES.get(names[0], names[0]))} title</b>\n<pre>{escape(title)}</pre>")
        if text:
            parts.append(f"<pre>{escape(text)}</pre>")
        if len(parts) > 1:
            _call(http, token, "sendMessage", chat_id=chat_id, text="\n".join(parts), parse_mode="HTML")
    if comment := post.get("first_comment"):  # Post.get strips; empty means none
        text = f"<b>First comment</b>\n<pre>{escape(comment)}</pre>"
        _call(http, token, "sendMessage", chat_id=chat_id, text=text, parse_mode="HTML")
    return str(first_id)


def send_text(http: httpx.Client, token: str, chat_id: str, text: str) -> None:
    _call(http, token, "sendMessage", chat_id=chat_id, text=text)


def bot_name(http: httpx.Client, token: str) -> str:
    return _call(http, token, "getMe")["username"]


def _call(http: httpx.Client, token: str, method: str, **params: str) -> dict:
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
        return body["result"]
    description = body.get("description") or f"HTTP {response.status_code}"
    if response.status_code in (401, 404):
        raise PlatformError("auth", "Telegram bot token is wrong or revoked: check TELEGRAM_BOT_TOKEN")
    if response.status_code == 429:
        raise PlatformError("rate", f"Telegram rate limit: {description}")
    if response.status_code >= 500:
        raise PlatformError("transient", f"Telegram had a temporary problem: {description}")
    raise PlatformError("permanent", f"Telegram refused the message: {description}")
