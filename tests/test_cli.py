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
    result = invoke(monkeypatch, ["publish"], env={})
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
