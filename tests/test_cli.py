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
