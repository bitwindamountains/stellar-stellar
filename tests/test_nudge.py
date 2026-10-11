from datetime import UTC, datetime

import pytest

from postpilot.config import ConfigError, load_config
from postpilot.nudge import nudge_window

BASE = {"GOOGLE_SHEET_ID": "s", "GOOGLE_SERVICE_ACCOUNT_FILE": "f", "META_GRAPH_VERSION": "v23.0"}


def test_window_is_first_half_hour_of_the_local_hour():
    # 16:07 Manila = 08:07 UTC
    start, end = nudge_window(datetime(2026, 10, 5, 8, 7, tzinfo=UTC), "Asia/Manila", 16)
    assert start == datetime(2026, 10, 4, 16, 0, tzinfo=UTC)  # Oct 5 00:00 Manila
    assert end == datetime(2026, 10, 5, 16, 0, tzinfo=UTC)
    assert nudge_window(datetime(2026, 10, 5, 8, 37, tzinfo=UTC), "Asia/Manila", 16) is None
    assert nudge_window(datetime(2026, 10, 5, 9, 7, tzinfo=UTC), "Asia/Manila", 16) is None


def test_nudge_hour_setting():
    assert load_config(BASE).nudge_hour == 16
    assert load_config({**BASE, "PP_NUDGE_HOUR": "9"}).nudge_hour == 9
    assert load_config({**BASE, "PP_NUDGE_HOUR": "0"}).nudge_hour == 0
    assert load_config({**BASE, "PP_NUDGE_HOUR": "off"}).nudge_hour is None
    with pytest.raises(ConfigError, match="PP_NUDGE_HOUR"):
        load_config({**BASE, "PP_NUDGE_HOUR": "24"})
