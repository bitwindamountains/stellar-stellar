import os
from collections.abc import Mapping
from dataclasses import dataclass


class ConfigError(Exception):
    """Bad or missing settings. Messages name variables, never their values."""


@dataclass(frozen=True)
class Config:
    sheet_id: str
    service_account_json: str
    service_account_file: str
    meta_graph_version: str
    telegram_bot_token: str
    telegram_chat_id: str
    late_grace_minutes: int
    max_posts_per_run: int
    max_attempts: int
    stale_posting_minutes: int
    supabase_url: str
    supabase_service_role_key: str
    web_app_url: str  # Telegram messages link to the app's handoff page
    nudge_hour: int | None  # local hour for the 'nothing posted today' Telegram nudge; None = off
    tiktok_privacy: str  # SELF_ONLY until TikTok audits the app; then e.g. PUBLIC_TO_EVERYONE
    env: Mapping[str, str]  # account tokens and X/TikTok client secrets are looked up by name from here


def _hour(value: str) -> int | None:
    if value.strip().lower() == "off":
        return None
    try:
        hour = int(value)
    except ValueError:
        hour = -1
    if not 0 <= hour <= 23:
        raise ConfigError("PP_NUDGE_HOUR must be an hour from 0 to 23, or off")
    return hour


TIKTOK_PRIVACY = ("SELF_ONLY", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "PUBLIC_TO_EVERYONE")


def _privacy(value: str) -> str:
    if value not in TIKTOK_PRIVACY:
        raise ConfigError("TIKTOK_PRIVACY_LEVEL must be one of: " + ", ".join(TIKTOK_PRIVACY))
    return value


def load_config(env: Mapping[str, str] | None = None) -> Config:
    env = os.environ if env is None else env
    missing = [] if env.get("META_GRAPH_VERSION") else ["META_GRAPH_VERSION"]
    if env.get("SUPABASE_URL"):  # Supabase replaces the Google Sheet
        missing += [] if env.get("SUPABASE_SERVICE_ROLE_KEY") else ["SUPABASE_SERVICE_ROLE_KEY"]
    else:
        missing += [] if env.get("GOOGLE_SHEET_ID") else ["GOOGLE_SHEET_ID"]
        if not env.get("GOOGLE_SERVICE_ACCOUNT_JSON") and not env.get("GOOGLE_SERVICE_ACCOUNT_FILE"):
            missing.append("GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_FILE")
    if missing:
        raise ConfigError("Missing settings: " + ", ".join(missing))

    def num(name: str, default: int) -> int:
        try:
            value = int(env.get(name) or default)
        except ValueError:
            raise ConfigError(f"{name} must be a whole number") from None
        if value < 1:
            raise ConfigError(f"{name} must be at least 1")
        return value

    return Config(
        sheet_id=env.get("GOOGLE_SHEET_ID", ""),
        service_account_json=env.get("GOOGLE_SERVICE_ACCOUNT_JSON", ""),
        service_account_file=env.get("GOOGLE_SERVICE_ACCOUNT_FILE", ""),
        meta_graph_version=env["META_GRAPH_VERSION"],
        telegram_bot_token=env.get("TELEGRAM_BOT_TOKEN", ""),
        telegram_chat_id=env.get("TELEGRAM_CHAT_ID", ""),
        late_grace_minutes=num("PP_LATE_GRACE_MINUTES", 180),
        max_posts_per_run=num("PP_MAX_POSTS_PER_RUN", 10),
        max_attempts=num("PP_MAX_ATTEMPTS", 3),
        stale_posting_minutes=num("PP_STALE_POSTING_MINUTES", 30),
        supabase_url=env.get("SUPABASE_URL", ""),
        supabase_service_role_key=env.get("SUPABASE_SERVICE_ROLE_KEY", ""),
        web_app_url=env.get("WEB_APP_URL", "").rstrip("/"),
        nudge_hour=_hour(env.get("PP_NUDGE_HOUR") or "16"),
        tiktok_privacy=_privacy(env.get("TIKTOK_PRIVACY_LEVEL") or "SELF_ONLY"),
        env=env,
    )
