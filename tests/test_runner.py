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


class EditedMidRun(FakeRepository):
    """Simulates the app changing rows after the publisher loaded them but before it claimed them."""

    def __init__(self, posts, accounts, change):
        super().__init__(posts, accounts)
        self.change = change

    def claim(self, claims):
        self.change(self)
        return super().claim(claims)


def test_claim_uses_content_edited_after_load():
    def edit(repo):
        repo.posts[1][repo.posts[0].index("caption")] = "edited caption"

    repo = EditedMidRun([row()], ACCOUNTS, edit)
    seen = []
    plats = Platforms(facebook=[PublishResult("F1", "")])
    publishers = {
        "facebook": lambda post, account: seen.append(post.text_for("facebook")) or PublishResult("F1", "")
    }
    run(repo, publishers, plats.assist, CFG, NOW)
    assert seen == ["edited caption"]
    assert repo.row(2)["status"] == "posted"


def test_post_deleted_or_unscheduled_after_load_is_not_published():
    def unschedule(repo):
        repo.posts[1][repo.posts[0].index("status")] = "draft"  # what a delete or edit-to-draft looks like

    repo = EditedMidRun([row()], ACCOUNTS, unschedule)
    plats = Platforms(facebook=[PublishResult("F1", "")])
    report = go(repo, plats)
    assert plats.calls == []
    assert repo.row(2)["status"] == "draft"
    assert any("changed" in line for line in report.lines)


def test_post_made_invalid_after_load_fails_instead_of_publishing():
    def break_it(repo):
        repo.posts[1][repo.posts[0].index("platforms")] = "instagram"  # no image: invalid for Instagram

    repo = EditedMidRun([row()], ACCOUNTS, break_it)
    plats = Platforms()
    go(repo, plats)
    assert plats.calls == []
    assert repo.row(2)["status"] == "failed" and "Instagram needs an image" in repo.row(2)["last_error"]


VIDEO = {"media_type": "video", "media_urls": "https://x/a.mp4"}


def test_unconnected_tiktok_goes_to_telegram_and_counts_as_done():
    repo = FakeRepository([row(platforms="tiktok", **VIDEO)], ACCOUNTS)
    platforms = Platforms()
    report = go(repo, platforms)
    assert report.posted == [2]
    assert platforms.calls == [("telegram", 2, ("tiktok",))]
    assert repo.row(2)["tiktok_id"] == "telegram"
    assert repo.row(2)["tg_message_id"] == "77"


def test_connected_tiktok_uploads_to_drafts_then_sends_its_caption():
    repo = FakeRepository(
        [row(platforms="tiktok,youtube", **VIDEO)], ACCOUNTS, connected={"main": {"tiktok"}}
    )
    platforms = Platforms(tiktok=[PublishResult("pub_1", "")])
    report = run(repo, {"tiktok": platforms.publisher("tiktok")}, platforms.assist, CFG, NOW)
    assert report.posted == [2]
    assert platforms.calls == [("tiktok", 2), ("telegram", 2, ("tiktok", "youtube"))]
    assert repo.row(2)["tiktok_id"] == "pub_1"  # the upload ID stays: never uploaded twice
    assert repo.row(2)["tg_message_id"] == "77"


def test_draft_uploaded_on_a_retry_still_gets_its_caption_message():
    retry = row(platforms="tiktok,youtube", status="partial", attempts="1", tg_message_id="5", **VIDEO)
    repo = FakeRepository([retry], ACCOUNTS, connected={"main": {"tiktok"}})
    platforms = Platforms(tiktok=[PublishResult("pub_1", "")])
    run(repo, {"tiktok": platforms.publisher("tiktok")}, platforms.assist, CFG, NOW)
    assert platforms.calls == [("tiktok", 2), ("telegram", 2, ("tiktok",))]


def test_uploaded_draft_with_caption_sent_is_left_alone():
    done = row(
        platforms="tiktok", status="partial", attempts="1", tiktok_id="pub_1", tg_message_id="5", **VIDEO
    )
    repo = FakeRepository([done], ACCOUNTS, connected={"main": {"tiktok"}})
    platforms = Platforms(tiktok=[])
    report = run(repo, {"tiktok": platforms.publisher("tiktok")}, platforms.assist, CFG, NOW)
    assert report.posted == [2] and platforms.calls == []


def test_tiktok_sent_by_hand_is_never_posted_again_after_connecting():
    sent = row(
        platforms="tiktok", status="partial", attempts="1", tiktok_id="telegram", tg_message_id="5", **VIDEO
    )
    repo = FakeRepository([sent], ACCOUNTS, connected={"main": {"tiktok"}})
    platforms = Platforms(tiktok=[])
    report = run(repo, {"tiktok": platforms.publisher("tiktok")}, platforms.assist, CFG, NOW)
    assert report.posted == [2]
    assert platforms.calls == []


def test_x_published_and_written_back():
    repo = FakeRepository([row(platforms="x")], ACCOUNTS, connected={"main": {"x"}})
    platforms = Platforms(x=[PublishResult("123", "https://x.com/i/status/123")])
    report = run(repo, {"x": platforms.publisher("x")}, platforms.assist, CFG, NOW)
    assert report.posted == [2]
    assert repo.row(2)["x_post_id"] == "123"
    assert repo.row(2)["x_permalink"] == "https://x.com/i/status/123"
