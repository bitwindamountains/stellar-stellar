from dataclasses import dataclass

FACEBOOK = "facebook"
INSTAGRAM = "instagram"
API_PLATFORMS = (FACEBOOK, INSTAGRAM)
# No usable posting API for these yet: PostPilot sends them to Telegram for a manual share.
ASSISTED_PLATFORMS = ("fb_profile", "tiktok", "youtube")
PLATFORMS = API_PLATFORMS + ASSISTED_PLATFORMS

ID_COLUMN = {FACEBOOK: "fb_post_id", INSTAGRAM: "ig_media_id"}
PERMALINK_COLUMN = {FACEBOOK: "fb_permalink", INSTAGRAM: "ig_permalink"}

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

    def done(self, platform: str) -> bool:
        """A filled ID means: never publish this platform for this row again."""
        if platform in ID_COLUMN:
            return bool(self.get(ID_COLUMN[platform]))
        return bool(self.get("tg_message_id"))


@dataclass(frozen=True)
class PublishResult:
    id: str
    permalink: str


class PlatformError(Exception):
    """kind: auth | rate | transient | permanent | unknown.

    `unknown` means a publish call got no clear answer: it may have posted, so never retry automatically.
    """

    RETRYABLE = ("rate", "transient")

    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind

    @property
    def retryable(self) -> bool:
        return self.kind in self.RETRYABLE
