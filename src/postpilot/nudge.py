from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo


def nudge_window(now: datetime, timezone: str, hour: int) -> tuple[date, datetime, datetime] | None:
    """From `hour` (local time) to midnight: today's local date and its bounds in UTC; otherwise None.

    Scheduled runs can be hours apart, so the first run after the hour sends it; the store keeps it daily.
    """
    tz = ZoneInfo(timezone)
    local = now.astimezone(tz)
    if local.hour < hour:
        return None
    start = datetime.combine(local.date(), time(), tz)
    end = datetime.combine(local.date() + timedelta(days=1), time(), tz)
    return local.date(), start.astimezone(UTC), end.astimezone(UTC)
