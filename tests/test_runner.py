from datetime import UTC, datetime, timedelta

import pytest
from fakes import FakeRepository

from postpilot.config import load_config
from postpilot.models import PlatformError, PublishResult, StoreError
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
        def publish(post, account, save_id=None):
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
        "facebook": lambda post, account, save_id: (
            seen.append(post.text_for("facebook")) or PublishResult("F1", "")
        )
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


class Comments:
    """Scripted commenters: each platform's queue holds comment IDs or errors, consumed per call."""

    def __init__(self, **script):
        self.script = {k: list(v) for k, v in script.items()}
        self.calls = []

    def commenters(self):
        def commenter(platform):
            def comment(post, account, object_id):
                self.calls.append((platform, object_id, post.get("first_comment")))
                outcome = self.script[platform].pop(0)
                if isinstance(outcome, BaseException):
                    raise outcome
                return outcome

            return comment

        return {name: commenter(name) for name in ("facebook", "instagram")}


def go_c(repo, plats, comments, dry_run=False):
    return run(
        repo, plats.publishers(), plats.assist, CFG, NOW, dry_run=dry_run, commenters=comments.commenters()
    )


def test_comment_posted_after_publish():
    repo = FakeRepository([row(first_comment="hello")], ACCOUNTS)
    comments = Comments(facebook=["C1"])
    report = go_c(repo, Platforms(facebook=[PublishResult("P1", "")]), comments)
    assert comments.calls == [("facebook", "P1", "hello")]
    assert repo.writes[1][2]["fb_post_id"] == "P1" and repo.writes[2][2] == {"fb_comment_id": "C1"}
    assert repo.row(2)["status"] == "posted" and repo.row(2)["last_error"] == ""
    assert report.posted == [2] and "facebook comment" in report.lines[0]


def test_no_comment_without_text():
    repo = FakeRepository([row()], ACCOUNTS)
    comments = Comments(facebook=["C1"])
    go_c(repo, Platforms(facebook=[PublishResult("P1", "")]), comments)
    assert comments.calls == [] and repo.row(2)["status"] == "posted"


def test_partial_retries_only_comment():
    repo = FakeRepository(
        [row(status="partial", attempts="1", fb_post_id="P1", first_comment="hi")], ACCOUNTS
    )
    plats, comments = Platforms(facebook=[]), Comments(facebook=["C1"])
    report = go_c(repo, plats, comments)
    assert plats.calls == [] and comments.calls == [("facebook", "P1", "hi")]
    assert repo.row(2)["fb_comment_id"] == "C1" and repo.row(2)["status"] == "posted"
    assert report.posted == [2]


def test_retryable_comment_failure_is_partial():
    repo = FakeRepository([row(first_comment="hi")], ACCOUNTS)
    comments = Comments(facebook=[PlatformError("transient", "busy")])
    report = go_c(repo, Platforms(facebook=[PublishResult("P1", "")]), comments)
    r = repo.row(2)
    assert (r["status"], r["attempts"], r["fb_post_id"], r["fb_comment_id"]) == ("partial", "1", "P1", "")
    assert report.partial == [2]

    last = FakeRepository(
        [row(status="partial", attempts="2", fb_post_id="P1", first_comment="hi")], ACCOUNTS
    )
    report = go_c(last, Platforms(facebook=[]), Comments(facebook=[PlatformError("transient", "busy")]))
    r = last.row(2)
    assert (r["status"], r["attempts"], r["fb_comment_id"]) == ("posted", "3", "not-added") and r["posted_at"]
    assert r["last_error"] == "Comment not added on Facebook: add it by hand"
    assert report.posted == [2] and not report.failed
    assert report.lines[0].endswith(": Comment not added on Facebook: add it by hand")


@pytest.mark.parametrize(
    "kind, sentinel, note",
    [
        ("permanent", "not-added", "Comment not added on Instagram: add it by hand"),
        ("auth", "not-added", "Comment not added on Instagram: reconnect Meta in Accounts to allow comments"),
        (
            "unknown",
            "unclear",
            "Comment on Instagram may not have been added: check, and add it by hand if missing",
        ),
    ],
)
def test_permanent_and_unknown_comment_failure_end_posted(kind, sentinel, note):
    repo = FakeRepository([row(platforms="instagram", first_comment="hi", **IMG)], ACCOUNTS)
    comments = Comments(instagram=[PlatformError(kind, "no")])
    report = go_c(repo, Platforms(instagram=[PublishResult("M1", "")]), comments)
    r = repo.row(2)
    assert (r["status"], r["last_error"], r["ig_comment_id"]) == ("posted", note, sentinel)
    assert report.posted == [2] and report.lines[0].endswith(note)
    go_c(repo, Platforms(instagram=[]), comments)  # posted: never commented again
    assert len(comments.calls) == 1


def test_comment_failure_does_not_stop_other_platform():
    repo = FakeRepository([row(platforms="facebook,instagram", first_comment="hi", **IMG)], ACCOUNTS)
    plats = Platforms(facebook=[PublishResult("P1", "")], instagram=[PublishResult("M1", "")])
    comments = Comments(facebook=[PlatformError("permanent", "no")], instagram=["IC1"])
    report = go_c(repo, plats, comments)
    r = repo.row(2)
    assert (r["fb_post_id"], r["ig_media_id"], r["fb_comment_id"], r["ig_comment_id"]) == (
        "P1",
        "M1",
        "not-added",
        "IC1",
    )
    assert r["status"] == "posted" and r["last_error"] == "Comment not added on Facebook: add it by hand"
    assert report.posted == [2]


def test_post_error_keeps_todays_rules_with_comment_failure_in_message():
    repo = FakeRepository([row(platforms="facebook,instagram", first_comment="hi", **IMG)], ACCOUNTS)
    plats = Platforms(facebook=[PublishResult("P1", "")], instagram=[PlatformError("transient", "busy")])
    comments = Comments(facebook=[PlatformError("transient", "slow")])
    go_c(repo, plats, comments)
    r = repo.row(2)
    assert r["status"] == "partial" and "instagram: busy" in r["last_error"] and "slow" in r["last_error"]
    assert r["fb_comment_id"] == ""  # certainly not posted: retried next run


def test_unknown_comment_with_retryable_post_error_is_stored_and_never_retried():
    repo = FakeRepository([row(platforms="facebook,instagram", first_comment="hi", **IMG)], ACCOUNTS)
    plats = Platforms(
        facebook=[PublishResult("P1", "")],
        instagram=[PlatformError("transient", "busy"), PublishResult("M1", "")],
    )
    comments = Comments(facebook=[PlatformError("unknown", "timeout")], instagram=["IC1"])
    go_c(repo, plats, comments)
    r = repo.row(2)
    unclear = "Comment on Facebook may not have been added: check, and add it by hand if missing"
    assert (r["status"], r["fb_comment_id"]) == ("partial", "unclear")
    assert "instagram: busy" in r["last_error"] and unclear in r["last_error"]

    go_c(repo, plats, comments)
    r = repo.row(2)
    assert [c[0] for c in comments.calls] == ["facebook", "instagram"]  # Facebook never commented again
    assert (r["status"], r["ig_comment_id"], r["last_error"]) == ("posted", "IC1", unclear)


def test_given_up_comment_survives_a_reschedule():
    repo = FakeRepository([row(platforms="facebook,instagram", first_comment="hi", **IMG)], ACCOUNTS)
    plats = Platforms(
        facebook=[PublishResult("P1", "")],
        instagram=[PlatformError("permanent", "bad image"), PublishResult("M1", "")],
    )
    comments = Comments(facebook=[PlatformError("permanent", "no")], instagram=["IC1"])
    go_c(repo, plats, comments)
    r = repo.row(2)
    assert (r["status"], r["fb_comment_id"]) == ("failed", "not-added")
    assert "Comment not added on Facebook: add it by hand" in r["last_error"]

    repo.write({2: {"status": "scheduled", "attempts": "0"}})  # the user reschedules it
    go_c(repo, plats, comments)
    assert [c[0] for c in comments.calls] == ["facebook", "instagram"]
    assert repo.row(2)["status"] == "posted"


def test_unknown_comment_beside_retryable_comment_is_never_retried():
    repo = FakeRepository([row(platforms="facebook,instagram", first_comment="hi", **IMG)], ACCOUNTS)
    plats = Platforms(facebook=[PublishResult("P1", "")], instagram=[PublishResult("M1", "")])
    comments = Comments(
        facebook=[PlatformError("transient", "busy"), "C1"], instagram=[PlatformError("unknown", "?")]
    )
    go_c(repo, plats, comments)
    r = repo.row(2)
    assert (r["status"], r["fb_comment_id"], r["ig_comment_id"]) == ("partial", "", "unclear")
    go_c(repo, plats, comments)
    r = repo.row(2)
    assert [c[0] for c in comments.calls] == ["facebook", "instagram", "facebook"]
    note = "Comment on Instagram may not have been added: check, and add it by hand if missing"
    assert (r["status"], r["fb_comment_id"], r["last_error"]) == ("posted", "C1", note)


def test_exhausted_comment_only_ends_posted():
    repo = FakeRepository(
        [row(status="partial", attempts="3", fb_post_id="P1", first_comment="hi")], ACCOUNTS
    )
    comments = Comments(facebook=[])
    report = go_c(repo, Platforms(facebook=[]), comments)
    r = repo.row(2)
    assert (r["status"], r["last_error"]) == ("posted", "Comment not added on Facebook: add it by hand")
    assert r["fb_comment_id"] == "not-added" and r["posted_at"] and comments.calls == []
    assert report.posted == [2] and not report.failed


def test_exhausted_with_platform_left_fails_and_says_comment_is_by_hand():
    cells = dict(status="partial", attempts="3", fb_post_id="P1", first_comment="hi", last_error="Meta down.")
    repo = FakeRepository([row(platforms="facebook,instagram", **cells, **IMG)], ACCOUNTS)
    report = go_c(repo, Platforms(), Comments(facebook=[]))
    r = repo.row(2)
    assert (r["status"], r["fb_comment_id"]) == ("failed", "not-added") and report.failed == [2]
    want = "Gave up after 3 attempt(s). Meta down.; Comment not added on Facebook: add it by hand"
    assert r["last_error"] == want


def stuck(**cells):
    return row(
        status="posting",
        claimed_at="2026-10-05T09:00:00+00:00",
        fb_post_id="P1",
        first_comment="hi",
        **cells,
    )


def test_stale_comment_only_ends_posted():
    repo = FakeRepository(
        [stuck(platforms="facebook,instagram", ig_media_id="M1", ig_comment_id="IC1", **IMG)], ACCOUNTS
    )
    comments = Comments(facebook=[])
    report = go_c(repo, Platforms(), comments)
    r = repo.row(2)
    note = "Comment on Facebook may not have been added: check, and add it by hand if missing"
    assert (r["status"], r["last_error"], r["fb_comment_id"]) == ("posted", note, "unclear") and r[
        "posted_at"
    ]
    assert report.posted == [2] and not report.failed and comments.calls == []


def test_stale_with_platform_left_fails_and_flags_the_comment():
    repo = FakeRepository([stuck(platforms="facebook,tiktok", **VIDEO)], ACCOUNTS)
    comments = Comments(facebook=[])
    report = go_c(repo, Platforms(), comments)
    r = repo.row(2)
    assert (r["status"], r["fb_comment_id"]) == ("failed", "unclear") and report.failed == [2]
    assert "Check tiktok" in r["last_error"]
    assert "Comment on Facebook may not have been added: check" in r["last_error"]


def test_dry_run_comments_nothing_written():
    repo = FakeRepository([row(first_comment="hi")], ACCOUNTS)
    plats, comments = Platforms(), Comments()
    report = go_c(repo, plats, comments, dry_run=True)
    assert repo.writes == [] and plats.calls == [] and comments.calls == []
    assert report.posted == [2] and "facebook comment" in report.lines[0]


UNCLEAR = PlatformError(
    "unknown", "Facebook accepted the Reel but was still processing; check it's on your Page", object_id="V1"
)


def test_error_with_object_id_saves_the_id_and_fails_for_a_check():
    repo = FakeRepository([row()], ACCOUNTS)
    go(repo, Platforms(facebook=[UNCLEAR]))
    assert repo.row(2)["fb_post_id"] == "V1" and repo.row(2)["status"] == "failed"
    assert "facebook: Facebook accepted" in repo.row(2)["last_error"]


def test_no_first_comment_on_a_platform_that_errored_this_run():
    repo = FakeRepository([row(first_comment="hi")], ACCOUNTS)
    comments = Comments(facebook=["C1"])
    go_c(repo, Platforms(facebook=[UNCLEAR]), comments)
    assert comments.calls == [] and not repo.row(2).get("fb_comment_id")
    assert "Comment not added on Facebook: add it by hand" in repo.row(2)["last_error"]


def test_retry_after_object_id_error_never_resends_that_platform():
    repo = FakeRepository([row()], ACCOUNTS)
    plats = Platforms(facebook=[UNCLEAR])
    go(repo, plats)
    repo.write({2: {"status": "scheduled"}})
    go(repo, plats)
    assert plats.calls == [("facebook", 2)]


def test_deadline_stops_new_posts_and_puts_claimed_rows_back():
    repo = FakeRepository([row(), row(attempts="1", status="partial", last_error="facebook: down")], ACCOUNTS)
    plats = Platforms(facebook=[PublishResult("F1", "")])
    ticks = iter([0, 100])  # row 2 starts in time, row 3 is past the deadline
    report = run(repo, plats.publishers(), plats.assist, CFG, NOW, deadline=50, clock=lambda: next(ticks))
    assert plats.calls == [("facebook", 2)] and report.posted == [2]
    r = repo.row(3)
    assert (r["status"], r["attempts"], r["claimed_at"], r["last_error"]) == (
        "partial",
        "1",
        "",
        "facebook: down",
    )
    assert any("row 3: put back" in line for line in report.lines)


class Killed(BaseException):
    """Stands in for the job being killed: nothing in the runner catches it."""


def test_id_saved_before_a_wait_survives_a_killed_run_and_is_never_resent():
    repo = FakeRepository([row(platforms="facebook,instagram", first_comment="hi", **IMG)], ACCOUNTS)
    calls = []

    def killed_mid_wait(post, account, save_id):
        calls.append(post.row)
        save_id("V1")
        raise Killed

    with pytest.raises(Killed):
        run(repo, {"facebook": killed_mid_wait}, None, CFG, NOW)
    r = repo.row(2)
    assert r["fb_post_id"] == "V1" and r["last_error"].startswith("facebook: ") and r["status"] == "posting"
    # The next run finds it stale: failed for a check, Facebook named, never sent again, never "posted".
    later = NOW + timedelta(minutes=CFG.stale_posting_minutes + 1)
    report = run(repo, {"facebook": killed_mid_wait}, None, CFG, later)
    r = repo.row(2)
    assert calls == [2] and report.failed == [2] and r["status"] == "failed"
    assert r["last_error"].startswith(
        "facebook: sent, not confirmed live yet; check it; Run stopped while posting."
    )
    assert "Check facebook, instagram" in r["last_error"]


def test_error_id_is_saved_with_its_error_in_one_write():
    repo = FakeRepository([row()], ACCOUNTS)
    go(repo, Platforms(facebook=[UNCLEAR]))
    first = repo.writes[1][2]  # writes[0] is the claim
    assert first["fb_post_id"] == "V1" and first["last_error"].startswith("facebook: Facebook accepted")


def test_mark_is_cleared_once_the_platform_succeeds():
    repo = FakeRepository([row()], ACCOUNTS)

    def slow_ok(post, account, save_id):
        save_id("V1")
        return PublishResult("V1", "https://fb/r")

    report = run(repo, {"facebook": slow_ok}, None, CFG, NOW)
    r = repo.row(2)
    assert report.posted == [2] and (r["status"], r["last_error"], r["fb_permalink"]) == (
        "posted",
        "",
        "https://fb/r",
    )


def test_stale_row_with_a_flagged_id_fails_instead_of_posting():
    # Facebook kept the ID of a Reel it never confirmed; only its first comment was left.
    msg = "facebook: Facebook accepted the Reel but was still processing; check it's on your Page"
    repo = FakeRepository([stuck(last_error=msg)], ACCOUNTS)
    report = go_c(repo, Platforms(), Comments(facebook=[]))
    r = repo.row(2)
    assert report.failed == [2] and r["status"] == "failed" and not r["posted_at"]
    assert r["last_error"].startswith(msg + "; Run stopped while posting. Check facebook, then reschedule")


def test_a_failed_id_save_stops_the_run():
    # The Reel is live but its ID couldn't be stored: carrying on would offer a Repost that posts it twice.
    repo = FakeRepository([row(), row(publish_at="2026-10-05 17:55")], ACCOUNTS)
    calls = []

    def save_fails(post, account, save_id):
        calls.append(post.row)
        save_id("V1")

    def broken_write(updates):
        if any("fb_post_id" in f for f in updates.values()):
            raise StoreError("Supabase 503 on posts")
        FakeRepository.write(repo, updates)

    repo.write = broken_write
    with pytest.raises(StoreError):
        run(repo, {"facebook": save_fails}, None, CFG, NOW)
    assert calls == [2] and repo.row(2)["status"] == "posting"
