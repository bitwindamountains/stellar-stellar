from typer.testing import CliRunner

from postpilot.cli import app


def test_help_lists_publish():
    result = CliRunner().invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "publish" in result.output


def test_publish_dry_run_stub():
    result = CliRunner().invoke(app, ["publish", "--dry-run"])
    assert result.exit_code == 0
    assert "dry run" in result.output.lower()


def test_missing_config_exits_2(monkeypatch):
    for k in (
        "GOOGLE_SHEET_ID",
        "META_GRAPH_VERSION",
        "GOOGLE_SERVICE_ACCOUNT_JSON",
        "GOOGLE_SERVICE_ACCOUNT_FILE",
    ):
        monkeypatch.delenv(k, raising=False)
    result = CliRunner().invoke(app, ["init-sheet"])
    assert result.exit_code == 2
    assert "GOOGLE_SHEET_ID" in result.output
