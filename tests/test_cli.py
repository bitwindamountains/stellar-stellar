from datetime import UTC, datetime

import pytest
from fakes import FakeRepository
from typer.testing import CliRunner

from postpilot import cli
from postpilot.cli import app

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
