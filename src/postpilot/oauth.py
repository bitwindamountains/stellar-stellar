from collections.abc import Mapping
from datetime import datetime, timedelta

import httpx

from postpilot import rest
from postpilot.models import PlatformError

X_TOKEN_URL = "https://api.x.com/2/oauth2/token"
TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"
REFRESH_EARLY = timedelta(minutes=5)


def needs_refresh(expires_at: str, now: datetime) -> bool:
    """expires_at is ISO time or '' (never expires)."""
    return bool(expires_at) and datetime.fromisoformat(expires_at) - REFRESH_EARLY <= now


def _classify(platform: str):
    def classify(status: int, body: dict) -> PlatformError:
        if status >= 500:
            return PlatformError("transient", f"{platform} login service had a temporary problem")
        # A refused refresh token won't work next run either.
        return PlatformError("auth", f"{platform} login expired: reconnect {platform} on the Accounts page")

    return classify


def refresh(
    http: httpx.Client, platform: str, refresh_token: str, env: Mapping[str, str], now: datetime
) -> tuple[dict, str]:
    """Trade a refresh token for new tokens. Returns (tokens JSON, expires_at ISO)."""
    if platform == "x":
        client_id, secret = env.get("X_CLIENT_ID", ""), env.get("X_CLIENT_SECRET", "")
        if not client_id:
            raise PlatformError("auth", "X_CLIENT_ID is not set (add it as a GitHub secret)")
        body = rest.call(
            http,
            "POST",
            X_TOKEN_URL,
            service="X",
            classify=_classify("X"),
            safe=True,
            auth=(client_id, secret) if secret else None,
            data={"grant_type": "refresh_token", "refresh_token": refresh_token, "client_id": client_id},
        )
    elif platform == "tiktok":
        key, secret = env.get("TIKTOK_CLIENT_KEY", ""), env.get("TIKTOK_CLIENT_SECRET", "")
        if not key or not secret:
            raise PlatformError("auth", "TIKTOK_CLIENT_KEY/TIKTOK_CLIENT_SECRET are not set (GitHub secrets)")
        body = rest.call(
            http,
            "POST",
            TIKTOK_TOKEN_URL,
            service="TikTok",
            classify=_classify("TikTok"),
            safe=True,
            data={
                "client_key": key,
                "client_secret": secret,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            },
        )
    else:
        raise PlatformError("auth", f"{platform} login can't be refreshed: reconnect it")
    if not body.get("access_token"):
        raise PlatformError("auth", f"{platform} refresh gave no token: reconnect it on the Accounts page")
    tokens = {
        "access_token": body["access_token"],
        "refresh_token": body.get("refresh_token") or refresh_token,  # X rotates it; TikTok may not
    }
    expires = now + timedelta(seconds=int(body.get("expires_in") or 3600))
    return tokens, expires.isoformat()
