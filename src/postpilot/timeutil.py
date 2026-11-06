from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

FORMATS = ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S")


def parse_local(text: str, timezone: str) -> datetime:
    """Parse a local `publish_at` ("YYYY-MM-DD HH:MM") in the account's time zone; return UTC."""
    try:
        tz = ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError(f"Unknown time zone '{timezone}' in Accounts tab") from None
    for fmt in FORMATS:
        try:
            return datetime.strptime(text.strip(), fmt).replace(tzinfo=tz).astimezone(UTC)
        except ValueError:
            continue
    raise ValueError("publish_at must look like 2026-10-05 18:00")
