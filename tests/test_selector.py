from datetime import UTC, datetime

from postpilot.models import Account, Post
from postpilot.selector import select

NOW = datetime(2026, 10, 5, 10, 0, tzinfo=UTC)  # 18:00 Manila
ACCOUNTS = {"main": Account("main", "PAGE", "IG", "T", "Asia/Manila")}


def p(row, **cells):
    base = {"account": "main", "platforms": "facebook", "caption": "hi", "status": "scheduled"}
    return Post(row=row, cells={**base, **cells})


def sel(posts, limit=10):
    return select(posts, ACCOUNTS, NOW, grace_minutes=180, max_attempts=3, stale_minutes=30, limit=limit)


def rows(posts):
    return [x.row for x in posts]


def test_due_missed_future_and_ignored_statuses():
    s = sel(
        [
            p(2, publish_at="2026-10-05 18:00"),  # exactly now: due
            p(3, publish_at="2026-10-05 14:59"),  # 3h01m late: missed
            p(4, publish_at="2026-10-05 18:01"),  # future
            p(5, publish_at="2026-10-05 17:00", status="draft"),
            p(6, publish_at="2026-10-05 17:00", status="posted"),
        ]
    )
    assert rows(s.due) == [2] and rows(s.missed) == [3]
    assert not s.stale and not s.exhausted and not s.invalid


def test_due_sorted_by_time_and_capped():
    s = sel(
        [
            p(2, publish_at="2026-10-05 17:30"),
            p(3, publish_at="2026-10-05 17:00"),
            p(4, publish_at="2026-10-05 17:00"),
        ],
        limit=2,
    )
    assert rows(s.due) == [3, 4]


def test_partial_retried_until_attempts_run_out():
    s = sel(
        [
            p(2, status="partial", attempts="2", publish_at="2026-10-05 17:00"),
            p(3, status="partial", attempts="3", publish_at="2026-10-05 17:00"),
            p(4, status="partial", attempts="1", publish_at="2026-10-05 12:00"),
        ]
    )
    assert rows(s.due) == [2] and rows(s.exhausted) == [3, 4]


def test_stale_posting_rows():
    s = sel(
        [
            p(2, status="posting", claimed_at="2026-10-05T09:29:00+00:00"),
            p(3, status="posting", claimed_at="2026-10-05T09:45:00+00:00"),
            p(4, status="posting", claimed_at="garbage"),
        ]
    )
    assert rows(s.stale) == [2, 4]


def test_invalid_scheduled_rows_reported_even_if_future():
    s = sel([p(2, publish_at="2026-12-01 10:00", platforms="instagram")])
    assert rows(s.due) == []
    assert s.invalid[0][0].row == 2 and "Instagram needs an image" in s.invalid[0][1][0]
