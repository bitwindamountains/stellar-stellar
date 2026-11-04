import json
from dataclasses import dataclass

FACEBOOK = "facebook"
INSTAGRAM = "instagram"
X = "x"
TIKTOK = "tiktok"
SHOPEE = "shopee"
API_PLATFORMS = (FACEBOOK, INSTAGRAM, X, TIKTOK)
# Sent to Telegram for a manual share. TikTok is in both: it goes by hand until the account connects TikTok.
ASSISTED_PLATFORMS = ("fb_profile", TIKTOK, "youtube", SHOPEE)
PLATFORMS = tuple(dict.fromkeys(API_PLATFORMS + ASSISTED_PLATFORMS))
# Uploaded by API as a draft (TikTok inbox): you still finish it in the app, with the caption from Telegram.
FINISH_IN_APP = (TIKTOK,)

ID_COLUMN = {FACEBOOK: "fb_post_id", INSTAGRAM: "ig_media_id", X: "x_post_id", TIKTOK: "tiktok_id"}
PERMALINK_COLUMN = {
    FACEBOOK: "fb_permalink",
    INSTAGRAM: "ig_permalink",
    X: "x_permalink",
    TIKTOK: "tiktok_permalink",
}
COMMENT_COLUMN = {FACEBOOK: "fb_comment_id", INSTAGRAM: "ig_comment_id"}
# Stored in the comment column when we give up, so a filled column always means: never comment again.
COMMENT_NOT_ADDED = "not-added"  # certainly not posted (permanent, auth, or out of retries)
COMMENT_UNCLEAR = "unclear"  # no clear answer: it may have been posted
SENT_BY_HAND = (
    "telegram"  # TikTok's ID when it went out through Telegram: still done, never auto-posted later
)

STATUSES = ("draft", "scheduled", "posting", "posted", "partial", "failed", "missed")
MEDIA_TYPES = ("none", "image", "video")

POST_COLUMNS = (
    "account",
    "platforms",
    "publish_at",
    "caption",
    "media_type",
    "media_urls",
    "link",
    "status",
    "attempts",
    "claimed_at",
    "fb_post_id",
    "fb_permalink",
    "ig_media_id",
    "ig_permalink",
    "x_post_id",
    "x_permalink",
    "tiktok_id",
    "tiktok_permalink",
    "tg_message_id",
    "last_error",
    "posted_at",
)
ACCOUNT_COLUMNS = ("account", "fb_page_id", "ig_user_id", "token_env", "timezone")
DEFAULT_TIMEZONE = "Asia/Manila"


@dataclass(frozen=True)
class Account:
    name: str
    fb_page_id: str
    ig_user_id: str
    token_env: str
    timezone: str
    connected: frozenset[str] = frozenset()  # saved logins: "meta" (Facebook+Instagram), "x", "tiktok"

    def by_api(self, platform: str) -> bool:
        """TikTok posts automatically only once connected; the other API platforms always do."""
        if platform == TIKTOK:
            return TIKTOK in self.connected
        return platform in API_PLATFORMS

    @classmethod
    def from_cells(cls, cells: dict[str, str]) -> "Account":
        def get(col: str) -> str:
            return (cells.get(col) or "").strip()

        return cls(
            name=get("account"),
            fb_page_id=get("fb_page_id"),
            ig_user_id=get("ig_user_id"),
            token_env=get("token_env"),
            timezone=get("timezone") or DEFAULT_TIMEZONE,
        )


@dataclass
class Post:
    row: int  # 1-based sheet row number
    cells: dict[str, str]

    def get(self, col: str) -> str:
        return (self.cells.get(col) or "").strip()

    @property
    def platforms(self) -> list[str]:
        names = (p.strip().lower() for p in self.get("platforms").split(","))
        return list(dict.fromkeys(n for n in names if n))

    @property
    def media_urls(self) -> list[str]:
        return [u.strip() for u in self.get("media_urls").splitlines() if u.strip()]

    @property
    def variants(self) -> dict[str, dict[str, str]]:
        """Per-platform overrides: {platform: {caption?, hashtags?, title?}}. Bad JSON counts as none."""
        try:
            value = json.loads(self.get("variants") or "{}")
        except ValueError:
            return {}
        return value if isinstance(value, dict) else {}

    @property
    def stats(self) -> dict:
        """Per-platform counts {platform: {...}}. Bad JSON counts as none."""
        try:
            value = json.loads(self.get("stats") or "{}")
        except ValueError:
            return {}
        return value if isinstance(value, dict) else {}

    def _variant(self, platform: str, key: str) -> str:
        variant = self.variants.get(platform)
        return str(variant.get(key) or "").strip() if isinstance(variant, dict) else ""

    def text_for(self, platform: str) -> str:
        """The platform's caption override (or the base caption), then its hashtags line."""
        caption = self._variant(platform, "caption") or self.get("caption")
        return "\n\n".join(t for t in (caption, self._variant(platform, "hashtags")) if t)

    def title_for(self, platform: str) -> str:
        return self._variant(platform, "title")

    def done(self, platform: str) -> bool:
        """A filled ID means: never publish this platform for this row again."""
        if platform in ID_COLUMN:
            return bool(self.get(ID_COLUMN[platform]))
        return bool(self.get("tg_message_id"))

    def comment_pending(self, platform: str) -> bool:
        """The platform's post is out but its first comment isn't: comment once, never twice."""
        return bool(
            self.get("first_comment")
            and platform in COMMENT_COLUMN
            and self.done(platform)
            and not self.get(COMMENT_COLUMN[platform])
        )


@dataclass(frozen=True)
class PublishResult:
    id: str
    permalink: str


class PlatformError(Exception):
    """kind: auth | rate | transient | permanent | unknown.

    `unknown` means a publish call got no clear answer: it may have posted, so never retry automatically.
    """

    RETRYABLE = ("rate", "transient")

    def __init__(self, kind: str, message: str, object_id: str = ""):
        super().__init__(message)
        self.kind = kind
        self.object_id = object_id  # set: the platform holds this object; save it so it's never sent again

    @property
    def retryable(self) -> bool:
        return self.kind in self.RETRYABLE


class StoreError(Exception):
    """The post store (Google Sheet or Supabase) can't be read or written."""
