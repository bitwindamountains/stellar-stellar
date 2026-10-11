import typer

app = typer.Typer(help="Publish due posts from a Google Sheet content calendar.", no_args_is_help=True)


@app.callback()
def main() -> None:
    """Keep subcommands as a group even while only one exists."""


@app.command()
def publish(
    dry_run: bool = typer.Option(False, "--dry-run", help="Run without calling publish endpoints."),
) -> None:
    """Publish posts that are due."""
    # ponytail: stub until runner lands (blueprint Phase 6); only reports the mode.
    typer.echo("Dry run: nothing published." if dry_run else "Nothing to publish yet.")
