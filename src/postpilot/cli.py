import typer

from postpilot.config import Config, ConfigError, load_config
from postpilot.sheet import SheetError, init_sheet, open_spreadsheet

app = typer.Typer(help="Publish due posts from a Google Sheet content calendar.", no_args_is_help=True)


@app.callback()
def main() -> None:
    """Keep subcommands as a group even while only one exists."""


def _config() -> Config:
    try:
        return load_config()
    except ConfigError as e:
        typer.echo(f"Config error: {e}", err=True)
        raise typer.Exit(2) from None


@app.command("init-sheet")
def init_sheet_command() -> None:
    """Create or repair the Posts and Accounts tabs (safe to re-run)."""
    try:
        init_sheet(open_spreadsheet(_config()))
    except SheetError as e:
        typer.echo(f"Sheet error: {e}", err=True)
        raise typer.Exit(2) from None
    typer.echo("Sheet ready: Posts and Accounts tabs have all columns.")


@app.command()
def publish(
    dry_run: bool = typer.Option(False, "--dry-run", help="Run without calling publish endpoints."),
) -> None:
    """Publish posts that are due."""
    # ponytail: stub until runner lands (blueprint Phase 6); only reports the mode.
    typer.echo("Dry run: nothing published." if dry_run else "Nothing to publish yet.")
