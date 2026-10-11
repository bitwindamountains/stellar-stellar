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
    env: Mapping[str, str]  # account tokens are looked up by name from here


def load_config(env: Mapping[str, str] | None = None) -> Config:
    env = os.environ if env is None else env
    missing = [k for k in ("GOOGLE_SHEET_ID", "META_GRAPH_VERSION") if not env.get(k)]
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
        sheet_id=env["GOOGLE_SHEET_ID"],
        service_account_json=env.get("GOOGLE_SERVICE_ACCOUNT_JSON", ""),
        service_account_file=env.get("GOOGLE_SERVICE_ACCOUNT_FILE", ""),
        meta_graph_version=env["META_GRAPH_VERSION"],
        telegram_bot_token=env.get("TELEGRAM_BOT_TOKEN", ""),
        telegram_chat_id=env.get("TELEGRAM_CHAT_ID", ""),
        late_grace_minutes=num("PP_LATE_GRACE_MINUTES", 180),
        max_posts_per_run=num("PP_MAX_POSTS_PER_RUN", 10),
        max_attempts=num("PP_MAX_ATTEMPTS", 3),
        stale_posting_minutes=num("PP_STALE_POSTING_MINUTES", 30),
        env=env,
    )
