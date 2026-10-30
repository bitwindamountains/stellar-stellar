from datetime import UTC, datetime

from postpilot import stats
from postpilot.models import Account, PlatformError, Post

NOW = datetime(2026, 10, 30, 12, 0, tzinfo=UTC)
ACC = Account("main", "PAGE", "IG", "T", "Asia/Manila")


class Repo:
    def __init__(self, posts):
        self.posts, self.accounts, self.saved, self.since = posts, {"1": ACC}, [], None

    def recent_posted(self, since):
        self.since = since
        return self.posts

    def save_stats(self, num, s):
        self.saved.append((num, s))


def post(num=1, fb="F1", ig="I1", old=None):
    import json

    return Post(
        row=num,
        cells={"account": "1", "fb_post_id": fb, "ig_media_id": ig, "stats": json.dumps(old or {})},
    )


def ok(data):
    return lambda p, a, i: data


def test_top_sorts_by_likes_then_newest():
    cs = [
        {"text": "a", "likes": 1, "at": "2026-10-02"},
        {"text": "b", "likes": 5, "at": "2026-10-01"},
        {"text": "c", "likes": 1, "at": "2026-10-03"},
    ]
    assert [c["text"] for c in stats.top(cs)] == ["b", "c", "a"]
    assert len(stats.top(cs * 3, n=2)) == 2


def test_refresh_saves_both_platforms_with_as_of():
    repo = Repo([post()])
    fetchers = {"facebook": ok({"likes": 3, "top_comments": []}), "instagram": ok({"reach": 9})}
    assert stats.refresh(repo, fetchers, NOW) == []
    num, saved = repo.saved[0]
    assert num == 1
    assert saved["facebook"] == {"likes": 3, "top_comments": [], "as_of": "2026-10-30T12:00:00+00:00"}
    assert saved["instagram"]["reach"] == 9 and saved["instagram"]["as_of"]
    assert repo.since == datetime(2026, 10, 23, 12, 0, tzinfo=UTC)


def test_refresh_keeps_old_stats_when_one_platform_fails():
    old = {"instagram": {"likes": 7, "as_of": "old"}}
    repo = Repo([post(old=old)])

    def boom(p, a, i):
        raise PlatformError("auth", "secret token abc")

    lines = stats.refresh(repo, {"facebook": ok({"likes": 1}), "instagram": boom}, NOW)
    assert lines == ["row 1: stats skipped on instagram (auth)"]
    assert repo.saved[0][1]["instagram"] == {"likes": 7, "as_of": "old"}
    assert repo.saved[0][1]["facebook"]["likes"] == 1


def test_refresh_does_not_write_when_everything_fails():
    def boom(p, a, i):
        raise PlatformError("rate", "x")

    repo = Repo([post()])
    stats.refresh(repo, {"facebook": boom, "instagram": boom}, NOW)
    assert repo.saved == []


def test_refresh_skips_by_hand_and_empty_ids():
    calls = []

    def spy(p, a, i):
        calls.append(i)
        return {}

    repo = Repo([post(fb="", ig="telegram")])
    stats.refresh(repo, {"facebook": spy, "instagram": spy}, NOW)
    assert calls == [] and repo.saved == []


def test_refresh_skips_post_with_unknown_account_and_any_exception():
    def broken_token(p, a, i):
        raise KeyError("access_token secret")  # e.g. token() blowing up inside the fetcher

    orphan = Post(row=2, cells={"account": "gone", "fb_post_id": "F2", "stats": "{}"})
    repo = Repo([post(), orphan])
    lines = stats.refresh(repo, {"facebook": ok({"likes": 1}), "instagram": broken_token}, NOW)
    assert lines == [
        "row 1: stats skipped on instagram (KeyError)",
        "row 2: stats skipped on facebook (KeyError)",
    ]
    assert [n for n, _ in repo.saved] == [1]


def test_refresh_stops_when_time_budget_is_spent():
    ticks = iter([0, 0, 30, 61, 999])  # start, then one tick before each post
    repo = Repo([post(n) for n in range(1, 5)])
    lines = stats.refresh(repo, {"facebook": ok({})}, NOW, budget_s=60, clock=lambda: next(ticks))
    assert [n for n, _ in repo.saved] == [1, 2]
    assert lines == ["stats: stopped after 2 post(s), time budget reached"]


def test_refresh_respects_limit():
    repo = Repo([post(n) for n in range(1, 6)])
    stats.refresh(repo, {"facebook": ok({})}, NOW, limit=2)
    assert [n for n, _ in repo.saved] == [1, 2]
