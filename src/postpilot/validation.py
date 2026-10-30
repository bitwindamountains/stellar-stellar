import re

from postpilot.models import (
    ASSISTED_PLATFORMS,
    FACEBOOK,
    INSTAGRAM,
    MEDIA_TYPES,
    PLATFORMS,
    TIKTOK,
    Account,
    Post,
    X,
)
from postpilot.timeutil import parse_local

X_TEXT_MAX = 280
TIKTOK_CAPTION_MAX = 2200
# X counts any link as 23, with or without https://.
# ponytail: common TLDs only (twitter-text has the full list); a rarer bare domain counts as plain text.
TLDS = "com|net|org|info|biz|io|co|me|app|dev|ai|ly|gg|tv|xyz|shop|store|online|site|link"
TLDS += "|ph|sg|my|jp|us|uk|ca|au"
URL = re.compile(rf"https?://\S+|\b(?:[a-z0-9-]+\.)+(?:{TLDS})\b(?:/\S*)?", re.IGNORECASE)
IG_CAPTION_MAX = 2200
IG_HASHTAGS_MAX = 30
IG_COMMENT_MAX = 300  # Meta's IG comment limits: 300 chars, 4 hashtags, 1 link, not all caps
IG_COMMENT_HASHTAGS_MAX = 4
IG_COMMENT_URLS_MAX = 1
TELEGRAM_MESSAGE_MAX = 4096
TELEGRAM_OVERHEAD = 60  # platform label line and title label (Telegram counts text after parsing tags)
NON_JPEG = (".png", ".webp", ".gif", ".heic", ".heif", ".avif", ".bmp", ".tif", ".tiff", ".svg")
# (links with no extension get the benefit of the doubt)
YOUTUBE_TITLE_MAX = 100


def validate(post: Post, accounts: dict[str, Account]) -> list[str]:
    """Plain-language problems that stop a row from publishing. Empty list = OK."""
    errors: list[str] = []
    account = accounts.get(post.get("account"))
    if account is None:
        errors.append(f"Unknown account '{post.get('account')}' (add it to the Accounts tab)")

    platforms = post.platforms
    if not platforms:
        errors.append("Pick at least one platform")
    errors += [
        f"Unknown platform '{p}' (use: {', '.join(PLATFORMS)})" for p in platforms if p not in PLATFORMS
    ]

    if account:
        if FACEBOOK in platforms and not account.fb_page_id:
            errors.append(f"Account '{account.name}' has no fb_page_id")
        if INSTAGRAM in platforms and not account.ig_user_id:
            errors.append(f"Account '{account.name}' has no ig_user_id")
        meta = {FACEBOOK, INSTAGRAM} & set(platforms)
        if meta and not account.token_env and "meta" not in account.connected:
            errors.append(
                f"Account '{account.name}' has no token_env (or connect Facebook on the Accounts page)"
            )
        if X in platforms and "x" not in account.connected:
            errors.append(f"Account '{account.name}' isn't linked to X: connect X on the Accounts page")
        try:
            parse_local(post.get("publish_at"), account.timezone)
        except ValueError as e:
            errors.append(str(e))

    media_type = post.get("media_type").lower() or "none"
    urls = post.media_urls
    if media_type not in MEDIA_TYPES:
        errors.append(f"media_type must be one of: {', '.join(MEDIA_TYPES)}")
    elif media_type == "none" and urls:
        errors.append("media_urls is filled: set media_type to image or video")
    elif media_type != "none" and not urls:
        errors.append(f"media_type is {media_type} but media_urls is empty")
    errors += [
        f"Media link must start with https:// ({u})" for u in urls if not u.lower().startswith("https://")
    ]
    if any("drive.google.com" in u.lower() for u in urls):
        errors.append("Google Drive links open a web page, not the file: use a direct link (e.g. Cloudinary)")
    if len(urls) > 1:
        errors.append("Only one image per post for now (carousels come later)")

    api_platforms = {FACEBOOK, INSTAGRAM} & set(platforms)
    if media_type == "video" and api_platforms:
        errors.append(
            "Video to Facebook/Instagram isn't supported yet; use tiktok/youtube/fb_profile for now"
        )
    if INSTAGRAM in platforms:
        if media_type != "image":
            errors.append("Instagram needs an image (media_type image + media_urls)")
        elif urls and re.split(r"[?#]", urls[0].lower())[0].endswith(NON_JPEG):
            errors.append("Instagram needs a JPEG image (PNG, WebP and GIF are rejected at post time)")
        caption = post.text_for(INSTAGRAM)
        if len(caption) > IG_CAPTION_MAX:
            errors.append(
                f"Instagram captions max {IG_CAPTION_MAX:,} characters (this one: {len(caption):,})"
            )
        if len(re.findall(r"#\w+", caption)) > IG_HASHTAGS_MAX:
            errors.append(f"Instagram allows at most {IG_HASHTAGS_MAX} hashtags")
    if FACEBOOK in platforms and not (post.text_for(FACEBOOK) or post.get("link") or urls):
        errors.append("Facebook post is empty: add a caption, link or image")
    if {"tiktok", "youtube"} & set(platforms) and media_type != "video":
        errors.append("TikTok/YouTube need a video (media_type video + media_urls)")
    if X in platforms:
        if media_type == "video":
            errors.append("Video to X isn't supported yet; use an image or text")
        size = x_length("\n\n".join(t for t in (post.text_for(X), post.get("link")) if t))
        if size > X_TEXT_MAX:
            errors.append(f"X posts max {X_TEXT_MAX} characters (this one counts {size:,})")
    if TIKTOK in platforms and account and account.by_api(TIKTOK):
        size = _telegram_len(post.text_for(TIKTOK))  # TikTok counts UTF-16 units too
        if size > TIKTOK_CAPTION_MAX:
            errors.append(f"TikTok captions max {TIKTOK_CAPTION_MAX:,} characters (this one: {size:,})")
    for p in set(ASSISTED_PLATFORMS) & set(platforms):
        # Telegram's 4,096 limit counts text after it parses the HTML: visible text, link, title, labels.
        text = post.text_for(p)
        if p == "fb_profile" and post.get("link"):
            text = f"{text}\n\n{post.get('link')}"
        size = _telegram_len(text) + _telegram_len(post.title_for(p)) + TELEGRAM_OVERHEAD
        if size > TELEGRAM_MESSAGE_MAX:
            over = size - TELEGRAM_MESSAGE_MAX
            errors.append(f"{p} caption too long for the Telegram assist: shorten it by {over:,} characters")
    first = post.get("first_comment")
    if first:
        if INSTAGRAM in platforms:
            if len(first) > IG_COMMENT_MAX:
                errors.append(f"First comment: Instagram allows at most {IG_COMMENT_MAX} characters")
            if len(re.findall(r"#\w+", first)) > IG_COMMENT_HASHTAGS_MAX:
                errors.append(f"First comment: Instagram allows at most {IG_COMMENT_HASHTAGS_MAX} hashtags")
            if len(re.findall(r"https?://", first)) > IG_COMMENT_URLS_MAX:
                errors.append(f"First comment: Instagram allows at most {IG_COMMENT_URLS_MAX} link")
            if first.isupper():
                errors.append("First comment: Instagram rejects all-caps comments")
        by_hand = any(p in PLATFORMS and not (account and account.by_api(p)) for p in platforms)
        if by_hand and _telegram_len(first) + TELEGRAM_OVERHEAD > TELEGRAM_MESSAGE_MAX:
            errors.append("First comment too long for the phone handoff")
    if len(post.title_for("youtube")) > YOUTUBE_TITLE_MAX:
        errors.append(f"YouTube titles max {YOUTUBE_TITLE_MAX} characters")
    return errors


def x_length(text: str) -> int:
    """X's weighted count (twitter-text v3): links 23, Latin-range characters 1, others (CJK, emoji) 2."""
    size = 23 * len(URL.findall(text))
    joined = flag_open = False
    for ch in URL.sub("", text):
        cp = ord(ch)
        if cp == 0x200D:  # zero-width joiner: the next emoji is part of the same picture
            joined = True
            continue
        if 0xFE00 <= cp <= 0xFE0F or 0x1F3FB <= cp <= 0x1F3FF or cp == 0x20E3 or 0xE0020 <= cp <= 0xE007F:
            continue  # variation selector, skin tone, keycap, flag tag: no weight of their own
        if joined:
            joined = False
            continue
        if 0x1F1E6 <= cp <= 0x1F1FF:  # two regional indicators make one flag
            flag_open = not flag_open
            if not flag_open:
                continue
        else:
            flag_open = False
        light = cp <= 4351 or 8192 <= cp <= 8205 or 8208 <= cp <= 8223 or 8242 <= cp <= 8247
        size += 1 if light else 2
    return size


def _telegram_len(text: str) -> int:
    """Telegram counts UTF-16 units: an emoji outside the basic plane is 2 (JavaScript's .length agrees)."""
    return len(text.encode("utf-16-le")) // 2
