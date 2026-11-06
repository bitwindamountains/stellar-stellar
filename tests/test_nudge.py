from datetime import UTC, date, datetime

import pytest

from postpilot.config import ConfigError, load_config
from postpilot.nudge import nudge_window

BASE = {
    "SUPABASE_URL": "https://x.supabase.co",
    "SUPABASE_SERVICE_ROLE_KEY": "k",
    "META_GRAPH_VERSION": "v23.0",
}


def test_window_runs_from_the_local_hour_to_midnight():
    # 16:07 Manila = 08:07 UTC
    day, start, end = nudge_window(datetime(2026, 10, 5, 8, 7, tzinfo=UTC), "Asia/Manila", 16)
    assert day == date(2026, 10, 5)
    assert start == datetime(2026, 10, 4, 16, 0, tzinfo=UTC)  # Oct 5 00:00 Manila
    assert end == datetime(2026, 10, 5, 16, 0, tzinfo=UTC)
    # 23:50 Manila still counts as Oct 5; 15:59 is too early.
    assert nudge_window(datetime(2026, 10, 5, 15, 50, tzinfo=UTC), "Asia/Manila", 16)[0] == date(2026, 10, 5)
    assert nudge_window(datetime(2026, 10, 5, 7, 59, tzinfo=UTC), "Asia/Manila", 16) is None


def test_nudge_hour_setting():
    assert load_config(BASE).nudge_hour == 16
    assert load_config({**BASE, "PP_NUDGE_HOUR": "9"}).nudge_hour == 9
    assert load_config({**BASE, "PP_NUDGE_HOUR": "0"}).nudge_hour == 0
    assert load_config({**BASE, "PP_NUDGE_HOUR": "off"}).nudge_hour is None
    with pytest.raises(ConfigError, match="PP_NUDGE_HOUR"):
        load_config({**BASE, "PP_NUDGE_HOUR": "24"})
