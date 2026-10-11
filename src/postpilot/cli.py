import os
import time
from datetime import UTC, datetime

import httpx
import typer

from postpilot import facebook, instagram, telegram
from postpilot.config import Config, ConfigError, load_config
from postpilot.graph import GraphClient
from postpilot.models import API_PLATFORMS, PlatformError, StoreError
from postpilot.runner import run
from postpilot.sheet import SheetError, SheetRepository, init_sheet, open_spreadsheet
from postpilot.supabase_repo import SupabaseRepository
from postpilot.validation import validate

app = typer.Typer(help="Publish due posts from a Google Sheet content calendar.", no_args_is_help=True)


def _fail(message: str, code: int = 2) -> typer.Exit:
    typer.echo(message, err=True)
    return typer.Exit(code)


def _config() -> Config:
    try:
        return load_config()
    except ConfigError as e:
        raise _fail(f"Config error: {e}") from None


def _repository(cfg: Config):
    if cfg.supabase_url:
        return SupabaseRepository(cfg.supabase_url, cfg.supabase_service_role_key)
    try:
        return SheetRepository(open_spreadsheet(cfg))
    except SheetError as e:
        raise _fail(f"Sheet error: {e}") from None


def _load(repo):
    try:
        return repo.load()
    except StoreError as e:
        raise _fail(f"Store error: {e}") from None


@app.command("init-sheet")
def init_sheet_command() -> None:
    """Create or repair the Posts and Accounts tabs (safe to re-run)."""
    try:
        init_sheet(open_spreadsheet(_config()))
    except SheetError as e:
        raise _fail(f"Sheet error: {e}") from None
    typer.echo("Sheet ready: Posts and Accounts tabs have all columns.")


@app.command("validate")
def validate_command() -> None:
    """Check draft and scheduled rows; write problems to last_error."""
    repo = _repository(_config())
    posts, accounts = _load(repo)
    updates, bad = {}, 0
    for post in posts:
        if post.get("status").lower() not in ("", "draft", "scheduled"):
            continue
        errors = "; ".join(validate(post, accounts))
        bad += bool(errors)
        if errors != post.get("last_error"):
            updates[post.row] = {"last_error": errors}
    repo.write(updates)
    typer.echo(f"{bad} row(s) need fixing; see last_error." if bad else "All draft/scheduled rows look good.")
    if bad:
        raise typer.Exit(1)


@app.command()
def publish(
    dry_run: bool = typer.Option(False, "--dry-run", help="Show what would happen; change nothing."),
    local: bool = typer.Option(False, "--local", help="Allow a real publish outside GitHub Actions."),
) -> None:
    """Publish due posts. Exit 1 if any row failed or was missed (GitHub then emails you)."""
    # A laptop run overlapping a scheduled run could post the same row twice.
    if not dry_run and not local and not os.environ.get("GITHUB_ACTIONS"):
        raise _fail("Real publish outside GitHub Actions: pause the schedule first, then add --local.")
    cfg = _config()
    repo = _repository(cfg)
    http = httpx.Client(timeout=30)

    def publisher(module):
        def publish_one(post, account):
            token = cfg.env.get(account.token_env)
            if not token:
                raise PlatformError("auth", f"{account.token_env} is not set (add it as a GitHub secret)")
            return module.publish(GraphClient(cfg.meta_graph_version, token, http=http), account, post)

        return publish_one

    assist = None
    if cfg.telegram_bot_token and cfg.telegram_chat_id:

        def assist(post, platforms):
            link = f"{cfg.web_app_url}/#/handoff/{post.row}" if cfg.web_app_url else ""
            return telegram.send_assist(
                http, cfg.telegram_bot_token, cfg.telegram_chat_id, post, platforms, link
            )

    started = time.monotonic()
    try:
        report = run(
            repo,
            {"facebook": publisher(facebook), "instagram": publisher(instagram)},
            assist,
            cfg,
            datetime.now(UTC),
            dry_run=dry_run,
        )
    except StoreError as e:
        raise _fail(f"Store error: {e}") from None
    if hasattr(repo, "record_run") and not dry_run:
        counts = {k: len(getattr(report, k)) for k in ("posted", "partial", "failed", "missed")}
        repo.record_run(**counts, duration_ms=int((time.monotonic() - started) * 1000), dry_run=False)
    for line in report.lines:
        typer.echo(line)
    prefix = "Dry run: " if dry_run else ""
    typer.echo(
        f"{prefix}{len(report.posted)} posted, {len(report.partial)} retrying, "
        f"{len(report.failed)} failed, {len(report.missed)} missed."
    )
    if report.failed or report.missed:
        raise typer.Exit(1)


@app.command()
def doctor() -> None:
    """Check config, sheet access, Meta tokens and the Telegram bot."""
    cfg = _config()
    http = httpx.Client(timeout=30)
    problems = 0

    def check(label: str, fn) -> None:
        nonlocal problems
        try:
            typer.echo(f"OK   {label}: {fn()}")
        except (StoreError, PlatformError) as e:
            problems += 1
            typer.echo(f"FAIL {label}: {e}")

    repo = _repository(cfg)
    posts, accounts = _load(repo)
    typer.echo(f"OK   store: {len(posts)} active post(s), {len(accounts)} account(s)")
    for account in accounts.values():
        used = {p for post in posts if post.get("account") == account.name for p in post.platforms}
        if not used & set(API_PLATFORMS):
            continue

        def token_check(account=account):
            token = cfg.env.get(account.token_env)
            if not token:
                raise PlatformError("auth", f"{account.token_env} is not set")
            me = GraphClient(cfg.meta_graph_version, token, http=http).get("me", fields="id,name")
            return f"token works for '{me.get('name', me.get('id'))}'"

        check(f"account {account.name}", token_check)
    if cfg.telegram_bot_token and cfg.telegram_chat_id:
        check("telegram", lambda: "bot @" + telegram.bot_name(http, cfg.telegram_bot_token))
    else:
        typer.echo("SKIP telegram: not configured (needed for fb_profile, tiktok, youtube rows)")
    if problems:
        raise typer.Exit(1)
