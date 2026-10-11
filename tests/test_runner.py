from datetime import UTC, datetime

import pytest
from fakes import FakeRepository

from postpilot.config import load_config
from postpilot.models import PlatformError, PublishResult
from postpilot.runner import run

NOW = datetime(2026, 10, 5, 10, 0, tzinfo=UTC)
CFG = load_config({"GOOGLE_SHEET_ID": "s", "GOOGLE_SERVICE_ACCOUNT_FILE": "f", "META_GRAPH_VERSION": "v23.0"})
ACCOUNTS = [{"account": "main", "fb_page_id": "PAGE", "ig_user_id": "IG", "token_env": "T"}]
IMG = {"media_type": "image", "media_urls": "https://x/a.jpg"}


def row(**cells):
    return {
        "account": "main",
        "platforms": "facebook",
        "publish_at": "2026-10-05 17:50",
        "caption": "hi",
        "status": "scheduled",
        **cells,
    }


class Platforms:
    """Scripted publishers: each platform's queue holds results or errors, consumed per call."""

    def __init__(self, **script):
        self.script = {k: list(v) for k, v in script.items()}
        self.calls = []

    def publisher(self, platform):
        def publish(post, account):
            self.calls.append((platform, post.row))
            outcome = self.script[platform].pop(0)
            if isinstance(outcome, BaseException):
                raise outcome
            return outcome

        return publish

    def publishers(self):
        return {name: self.publisher(name) for name in ("facebook", "instagram")}

    def assist(self, post, platforms):
        self.calls.append(("telegram", post.row, tuple(platforms)))
        return "77"


def go(repo, platforms, assist=True):
    return run(repo, platforms.publishers(), platforms.assist if assist else None, CFG, NOW)


def test_publishes_all_platforms_and_writes_back():
    repo = FakeRepository(
        [row(platforms="facebook,instagram,fb_profile", media_type="image", media_urls="https://x/a.jpg")],
        ACCOUNTS,
    )
    plats = Platforms(
        facebook=[PublishResult("F1", "https://fb/1")], instagram=[PublishResult("M1", "https://ig/1")]
    )
    report = go(repo, plats)
    r = repo.row(2)
    assert (r["status"], r["fb_post_id"], r["ig_permalink"], r["tg_message_id"]) == (
        "posted",
        "F1",
        "https://ig/1",
        "77",
    )
    assert r["attempts"] == "1" and r["posted_at"] and r["last_error"] == ""
    assert report.posted == [2] and not report.failed


def test_claim_written_before_publishing_and_ids_written_one_by_one():
    repo = FakeRepository([row(platforms="facebook,instagram", **IMG)], ACCOUNTS)
    go(repo, Platforms(facebook=[PublishResult("F1", "")], instagram=[PublishResult("M1", "")]))
    assert repo.writes[0][2]["status"] == "posting"
    assert repo.writes[1][2] == {"fb_post_id": "F1", "fb_permalink": ""}
    assert repo.writes[2][2] == {"ig_media_id": "M1", "ig_permalink": ""}


def test_transient_failure_becomes_partial_and_retry_skips_done_platform():
    repo = FakeRepository([row(platforms="facebook,instagram", **IMG)], ACCOUNTS)
    plats = Platforms(
        facebook=[PublishResult("F1", "")],
        instagram=[PlatformError("transient", "busy"), PublishResult("M1", "")],
    )
    go(repo, plats)
    assert repo.row(2)["status"] == "partial" and "instagram: busy" in repo.row(2)["last_error"]
    go(repo, plats)
    assert repo.row(2)["status"] == "posted"
    assert plats.calls.count(("facebook", 2)) == 1  # never reposted
    assert repo.row(2)["attempts"] == "2"


def test_crash_after_facebook_before_instagram_never_reposts():
    repo = FakeRepository([row(platforms="facebook,instagram", **IMG)], ACCOUNTS)
    plats = Platforms(facebook=[PublishResult("F1", "")], instagram=[KeyboardInterrupt()])
    with pytest.raises(KeyboardInterrupt):
        go(repo, plats)
    assert repo.row(2)["status"] == "posting" and repo.row(2)["fb_post_id"] == "F1"
    later = datetime(2026, 10, 5, 10, 45, tzinfo=UTC)
    report = run(repo, plats.publishers(), plats.assist, CFG, later)
    r = repo.row(2)
    assert r["status"] == "failed" and "instagram" in r["last_error"] and "facebook" not in r["last_error"]
    assert report.failed == [2]
    assert plats.calls == [("facebook", 2), ("instagram", 2)]  # nothing called on the second run


def test_unknown_outcome_fails_without_retry():
    repo = FakeRepository([row()], ACCOUNTS)
    plats = Platforms(facebook=[PlatformError("unknown", "check it")])
    go(repo, plats)
    assert repo.row(2)["status"] == "failed"
    go(repo, plats)
    assert plats.calls == [("facebook", 2)]


def test_unexpected_exception_fails_row_without_leaking_text_and_run_continues():
    repo = FakeRepository([row(), row(publish_at="2026-10-05 17:55")], ACCOUNTS)
    plats = Platforms(facebook=[RuntimeError("secret https://x?access_token=ABC"), PublishResult("F2", "")])
    report = go(repo, plats)
    assert repo.row(2)["status"] == "failed" and "ABC" not in repo.row(2)["last_error"]
    assert repo.row(3)["status"] == "posted" and report.failed == [2]


def test_partial_out_of_attempts_becomes_failed():
    repo = FakeRepository([row(platforms="facebook")], ACCOUNTS)
    plats = Platforms(facebook=[PlatformError("transient", "busy")] * 3)
    for _ in range(3):
        go(repo, plats)
    assert repo.row(2)["status"] == "failed" and repo.row(2)["attempts"] == "3"


def test_missed_and_invalid_rows_marked():
    repo = FakeRepository([row(publish_at="2026-10-05 12:00"), row(platforms="instagram")], ACCOUNTS)
    report = go(repo, Platforms())
    assert repo.row(2)["status"] == "missed" and "late" in repo.row(2)["last_error"]
    assert repo.row(3)["status"] == "failed" and "Instagram needs an image" in repo.row(3)["last_error"]
    assert report.missed == [2] and report.failed == [3]


def test_assisted_rows_without_telegram_config_fail_clearly():
    repo = FakeRepository(
        [row(platforms="tiktok", media_type="video", media_urls="https://x/a.mp4")], ACCOUNTS
    )
    go(repo, Platforms(), assist=False)
    assert repo.row(2)["status"] == "failed" and "TELEGRAM_BOT_TOKEN" in repo.row(2)["last_error"]


def test_dry_run_writes_nothing_and_calls_nothing():
    repo = FakeRepository([row()], ACCOUNTS)
    plats = Platforms()
    report = run(repo, plats.publishers(), plats.assist, CFG, NOW, dry_run=True)
    assert repo.writes == [] and plats.calls == []
    assert report.posted == [2] and "would" in report.lines[0].lower()
