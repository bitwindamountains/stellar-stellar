from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo


def nudge_window(now: datetime, timezone: str, hour: int) -> tuple[datetime, datetime] | None:
    """Inside the first half hour of `hour` (local time), today's bounds in UTC; otherwise None.

    Runs start at :07 and :37, so exactly one scheduled run lands in that half hour each day.
    """
    tz = ZoneInfo(timezone)
    local = now.astimezone(tz)
    if local.hour != hour or local.minute >= 30:
        return None
    start = datetime.combine(local.date(), time(), tz)
    end = datetime.combine(local.date() + timedelta(days=1), time(), tz)
    return start.astimezone(UTC), end.astimezone(UTC)
