import re

from postpilot.models import ASSISTED_PLATFORMS, FACEBOOK, INSTAGRAM, MEDIA_TYPES, PLATFORMS, Account, Post
from postpilot.timeutil import parse_local

IG_CAPTION_MAX = 2200
IG_HASHTAGS_MAX = 30
TELEGRAM_MESSAGE_MAX = 4096
TELEGRAM_OVERHEAD = 60  # platform label line and title label (Telegram counts text after parsing tags)
NON_JPEG = (".png", ".webp", ".gif")  # links with no extension get the benefit of the doubt
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
        if {FACEBOOK, INSTAGRAM} & set(platforms) and not account.token_env:
            errors.append(f"Account '{account.name}' has no token_env")
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
    for p in set(ASSISTED_PLATFORMS) & set(platforms):
        # Telegram's 4,096 limit counts text after it parses the HTML: visible text, link, title, labels.
        text = post.text_for(p)
        if p == "fb_profile" and post.get("link"):
            text = f"{text}\n\n{post.get('link')}"
        size = len(text) + len(post.title_for(p)) + TELEGRAM_OVERHEAD
        if size > TELEGRAM_MESSAGE_MAX:
            over = size - TELEGRAM_MESSAGE_MAX
            errors.append(f"{p} caption too long for the Telegram assist: shorten it by {over:,} characters")
    if len(post.title_for("youtube")) > YOUTUBE_TITLE_MAX:
        errors.append(f"YouTube titles max {YOUTUBE_TITLE_MAX} characters")
    return errors
