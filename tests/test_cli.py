from datetime import UTC, datetime

import pytest
from fakes import FakeRepository
from typer.testing import CliRunner

from postpilot import cli
from postpilot.cli import app
from postpilot.runner import Report

ENV = {"GOOGLE_SHEET_ID": "s", "GOOGLE_SERVICE_ACCOUNT_FILE": "f", "META_GRAPH_VERSION": "v23.0"}
ACCOUNTS = [{"account": "main", "fb_page_id": "PAGE", "ig_user_id": "IG", "token_env": "T"}]


def invoke(monkeypatch, args, repo=None, env=ENV):
    for k in (
        "GOOGLE_SHEET_ID",
        "META_GRAPH_VERSION",
        "GOOGLE_SERVICE_ACCOUNT_JSON",
        "GOOGLE_SERVICE_ACCOUNT_FILE",
    ):
        monkeypatch.delenv(k, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    if repo is not None:
        monkeypatch.setattr(cli, "_repository", lambda cfg: repo)
    return CliRunner().invoke(app, args)


def test_help_lists_commands():
    result = CliRunner().invoke(app, ["--help"])
    assert result.exit_code == 0
    for name in ("init-sheet", "validate", "publish", "doctor"):
        assert name in result.output


def test_missing_config_exits_2(monkeypatch):
    result = invoke(monkeypatch, ["publish", "--dry-run"], env={})
    assert result.exit_code == 2 and "GOOGLE_SHEET_ID" in result.output


def test_validate_writes_errors_and_clears_fixed_rows(monkeypatch):
    repo = FakeRepository(
        [
            {
                "account": "main",
                "platforms": "instagram",
                "publish_at": "2026-10-05 18:00",
                "status": "draft",
            },
            {
                "account": "main",
                "platforms": "facebook",
                "publish_at": "2026-10-05 18:00",
                "caption": "ok",
                "status": "scheduled",
                "last_error": "old problem",
            },
            {"account": "main", "platforms": "nope", "status": "posted"},
        ],
        ACCOUNTS,
    )
    result = invoke(monkeypatch, ["validate"], repo)
    assert result.exit_code == 1
    assert "Instagram needs an image" in repo.row(2)["last_error"]
    assert repo.row(3)["last_error"] == ""
    assert repo.row(4)["last_error"] == ""  # posted rows are left alone
    assert "1 row(s) need fixing" in result.output


def test_publish_dry_run_reports_without_writing(monkeypatch):
    repo = FakeRepository(
        [
            {
                "account": "main",
                "platforms": "facebook",
                "publish_at": "2000-01-01 00:00",
                "caption": "x",
                "status": "scheduled",
            }
        ],
        ACCOUNTS,
    )
    result = invoke(monkeypatch, ["publish", "--dry-run"], repo)
    assert repo.writes == []
    assert "row 2: missed" in result.output and result.exit_code == 1


def test_real_publish_outside_github_needs_local_flag(monkeypatch):
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    repo = FakeRepository([], ACCOUNTS)
    result = invoke(monkeypatch, ["publish"], repo)
    assert result.exit_code == 2 and "--local" in result.output and repo.writes == []
    result = invoke(monkeypatch, ["publish", "--local"], repo)
    assert result.exit_code == 0


def test_supabase_backend_records_real_runs_only(monkeypatch):
    class Recording(FakeRepository):
        runs = []

        def record_run(self, **counts):
            self.runs.append(counts)

    repo = Recording([], ACCOUNTS)
    env = {
        "SUPABASE_URL": "https://x.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "k",
        "META_GRAPH_VERSION": "v23.0",
        "GITHUB_ACTIONS": "true",
    }
    assert invoke(monkeypatch, ["publish", "--dry-run"], repo, env=env).exit_code == 0
    assert repo.runs == []
    assert invoke(monkeypatch, ["publish"], repo, env=env).exit_code == 0
    assert repo.runs[0]["posted"] == 0 and repo.runs[0]["dry_run"] is False


class NudgeRepo(FakeRepository):
    """Supabase-like fake: records runs and answers 'how many live posts today'."""

    def __init__(self, live_today):
        super().__init__([], ACCOUNTS)
        self.live_today = live_today
        self.timezone = "Asia/Manila"

    def record_run(self, **counts):
        pass

    def count_live_between(self, start, end):
        return self.live_today


@pytest.mark.parametrize(
    ("live", "at", "expected"),
    [
        (0, datetime(2026, 10, 5, 8, 7, tzinfo=UTC), 1),  # 16:07 Manila, nothing today: nudge
        (2, datetime(2026, 10, 5, 8, 7, tzinfo=UTC), 0),  # something planned: quiet
        (0, datetime(2026, 10, 5, 8, 37, tzinfo=UTC), 0),  # 16:37: outside the window
    ],
)
def test_publish_nudges_on_empty_days(monkeypatch, live, at, expected):
    sent = []
    monkeypatch.setattr(cli, "_now", lambda: at)
    monkeypatch.setattr(cli.telegram, "send_text", lambda http, token, chat, text: sent.append(text))
    env = {
        "SUPABASE_URL": "https://x.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "k",
        "META_GRAPH_VERSION": "v23.0",
        "GITHUB_ACTIONS": "true",
        "TELEGRAM_BOT_TOKEN": "t",
        "TELEGRAM_CHAT_ID": "c",
        "WEB_APP_URL": "https://pp.example",
    }
    assert invoke(monkeypatch, ["publish"], NudgeRepo(live), env=env).exit_code == 0
    assert len(sent) == expected
    if sent:
        assert "https://pp.example/#/new" in sent[0]


class TokenRepo:
    def __init__(self, found, fail_save=False):
        self.found, self.fail_save, self.reads, self.saved = found, fail_save, 0, []
        self.still_connected = True

    def tokens(self, account, kind):
        self.reads += 1
        return self.found

    def save_tokens(self, account, kind, tokens, expires_at):
        if self.fail_save:
            raise cli.StoreError("down")
        self.saved.append((account, kind, tokens, expires_at))
        return self.still_connected


def token_helper(repo, monkeypatch, refreshed=None):
    calls = []

    def fake_refresh(http, kind, refresh_token, env, now):
        calls.append(refresh_token)
        return refreshed, "2026-10-28T12:00:00+00:00"

    monkeypatch.setattr(cli.oauth, "refresh", fake_refresh)
    cfg = cli.load_config({**ENV, "T": "ENVTOKEN"})
    return cli._tokens(repo, cfg, None, datetime(2026, 10, 28, 10, 0, tzinfo=UTC)), calls


def account(**kw):
    from postpilot.models import Account

    return Account(
        kw.get("name", "5"), "PAGE", "IG", kw.get("token_env", ""), "UTC", frozenset(kw.get("connected", ()))
    )


def test_expired_login_is_refreshed_saved_and_cached(monkeypatch):
    repo = TokenRepo(({"access_token": "OLD", "refresh_token": "R1"}, "2026-10-28T09:00:00+00:00"))
    token, calls = token_helper(repo, monkeypatch, {"access_token": "NEW", "refresh_token": "R2"})
    acct = account(connected={"x"})
    assert token(acct, "x") == "NEW" and token(acct, "x") == "NEW"
    assert calls == ["R1"] and repo.reads == 1
    assert repo.saved == [
        ("5", "x", {"access_token": "NEW", "refresh_token": "R2"}, "2026-10-28T12:00:00+00:00")
    ]


def test_refreshed_login_still_posts_when_saving_fails(monkeypatch):
    repo = TokenRepo(
        ({"access_token": "OLD", "refresh_token": "R1"}, "2026-10-28T09:00:00+00:00"), fail_save=True
    )
    token, _ = token_helper(repo, monkeypatch, {"access_token": "NEW", "refresh_token": "R2"})
    assert token(account(connected={"x"}), "x") == "NEW"


def test_meta_connection_wins_over_token_env(monkeypatch):
    repo = TokenRepo(({"access_token": "PAGETOKEN"}, ""))
    token, calls = token_helper(repo, monkeypatch)
    assert token(account(token_env="T", connected={"meta"}), "meta") == "PAGETOKEN" and calls == []
    assert token(account(name="6", token_env="T"), "meta") == "ENVTOKEN"


def test_unconnected_login_is_an_auth_error(monkeypatch):
    token, _ = token_helper(TokenRepo(None), monkeypatch)
    with pytest.raises(cli.PlatformError) as e:
        token(account(), "x")
    assert e.value.kind == "auth" and "connect it" in str(e.value)


def test_disconnect_during_refresh_stops_the_post(monkeypatch):
    repo = TokenRepo(({"access_token": "OLD", "refresh_token": "R1"}, "2026-10-28T09:00:00+00:00"))
    repo.still_connected = False
    token, _ = token_helper(repo, monkeypatch, {"access_token": "NEW", "refresh_token": "R2"})
    with pytest.raises(cli.PlatformError) as e:
        token(account(connected={"x"}), "x")
    assert "disconnected" in str(e.value)


def test_failed_refresh_is_not_repeated_in_the_same_run(monkeypatch):
    repo = TokenRepo(({"access_token": "OLD", "refresh_token": "R1"}, "2026-10-28T09:00:00+00:00"))
    calls = []

    def refused(http, kind, refresh_token, env, now):
        calls.append(refresh_token)
        raise cli.PlatformError("auth", "X login expired: reconnect X")

    monkeypatch.setattr(cli.oauth, "refresh", refused)
    token = cli._tokens(repo, cli.load_config(ENV), None, datetime(2026, 10, 28, 10, 0, tzinfo=UTC))
    for _ in range(2):
        with pytest.raises(cli.PlatformError):
            token(account(connected={"x"}), "x")
    assert calls == ["R1"]


def test_publish_passes_meta_commenters(monkeypatch):
    seen = {}

    def fake_run(*args, **kwargs):
        seen.update(kwargs)
        return Report()

    monkeypatch.setattr(cli, "run", fake_run)
    assert invoke(monkeypatch, ["publish", "--dry-run"], FakeRepository([], ACCOUNTS)).exit_code == 0
    assert set(seen["commenters"]) == {"facebook", "instagram"}


class StatsRepo(NudgeRepo):
    def __init__(self):
        super().__init__(1)

    def recent_posted(self, since):
        return []


def test_stats_store_error_keeps_exit_code_and_dry_run_skips(monkeypatch):
    calls = []

    def fake_refresh(repo, fetchers, now):
        calls.append(sorted(fetchers))
        raise cli.StoreError("down")

    monkeypatch.setattr(cli.stats, "refresh", fake_refresh)
    env = {
        "SUPABASE_URL": "https://x.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "k",
        "META_GRAPH_VERSION": "v23.0",
        "GITHUB_ACTIONS": "true",
    }
    result = invoke(monkeypatch, ["publish"], StatsRepo(), env=env)
    assert result.exit_code == 0 and "Stats skipped: down" in result.output
    assert calls == [["facebook", "instagram"]]
    assert invoke(monkeypatch, ["publish", "--dry-run"], StatsRepo(), env=env).exit_code == 0
    assert len(calls) == 1


def test_stats_any_error_keeps_exit_code_and_prints_after_report(monkeypatch):
    def fake_refresh(repo, fetchers, now):
        raise ValueError("token abc in here")

    monkeypatch.setattr(cli.stats, "refresh", fake_refresh)
    env = {
        "SUPABASE_URL": "https://x.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "k",
        "META_GRAPH_VERSION": "v23.0",
        "GITHUB_ACTIONS": "true",
    }
    result = invoke(monkeypatch, ["publish"], StatsRepo(), env=env)
    assert result.exit_code == 0 and "Stats skipped: ValueError" in result.output
    assert "abc" not in result.output
    assert result.output.index("posted,") < result.output.index("Stats skipped")
