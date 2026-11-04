import os
import time
from datetime import UTC, datetime

import httpx
import typer

from postpilot import facebook, instagram, oauth, stats, telegram, tiktok, x
from postpilot.config import Config, ConfigError, load_config
from postpilot.graph import GraphClient
from postpilot.models import DEFAULT_TIMEZONE, PlatformError, StoreError
from postpilot.nudge import nudge_window
from postpilot.runner import run
from postpilot.sheet import SheetError, SheetRepository, init_sheet, open_spreadsheet
from postpilot.supabase_repo import SupabaseRepository
from postpilot.validation import validate

app = typer.Typer(help="Publish due posts from a Google Sheet content calendar.", no_args_is_help=True)


def _now() -> datetime:
    return datetime.now(UTC)


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

    now = _now()
    token = _tokens(repo, cfg, http, now)

    def meta(module):
        def publish_one(post, account):
            graph = GraphClient(cfg.meta_graph_version, token(account, "meta"), http=http)
            # Video takes minutes to process: wait up to 5 minutes (checks are 5s apart).
            extra = {"checks": 60} if post.get("media_type") == "video" else {}
            return module.publish(graph, account, post, **extra)

        return publish_one

    def meta_comment(module):
        def comment_one(post, account, object_id):
            graph = GraphClient(cfg.meta_graph_version, token(account, "meta"), http=http)
            return module.comment(graph, object_id, post.get("first_comment"))

        return comment_one

    stats_http = httpx.Client(timeout=10)  # stats must not stall the run: short timeout, no retries

    def meta_stats(module):
        def stats_one(post, account, object_id):
            graph = GraphClient(cfg.meta_graph_version, token(account, "meta"), http=stats_http, attempts=1)
            return module.stats(graph, object_id)

        return stats_one

    fetchers = {"facebook": meta_stats(facebook), "instagram": meta_stats(instagram)}
    commenters = {"facebook": meta_comment(facebook), "instagram": meta_comment(instagram)}
    publishers = {
        "facebook": meta(facebook),
        "instagram": meta(instagram),
        "x": lambda post, account: x.publish(http, token(account, "x"), post),
        "tiktok": lambda post, account: tiktok.publish(http, token(account, "tiktok"), post),
    }

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
            publishers,
            assist,
            cfg,
            now,
            dry_run=dry_run,
            commenters=commenters,
        )
    except StoreError as e:
        raise _fail(f"Store error: {e}") from None
    if hasattr(repo, "record_run") and not dry_run:
        counts = {k: len(getattr(report, k)) for k in ("posted", "partial", "failed", "missed")}
        repo.record_run(**counts, duration_ms=int((time.monotonic() - started) * 1000), dry_run=False)
    if not dry_run and assist and cfg.nudge_hour is not None and hasattr(repo, "count_live_between"):
        _nudge_if_empty(repo, cfg, http, now)
    for line in report.lines:
        typer.echo(line)
    prefix = "Dry run: " if dry_run else ""
    typer.echo(
        f"{prefix}{len(report.posted)} posted, {len(report.partial)} retrying, "
        f"{len(report.failed)} failed, {len(report.missed)} missed."
    )
    if not dry_run and hasattr(repo, "recent_posted"):
        try:
            for line in stats.refresh(repo, fetchers, now):
                typer.echo(line)
        except StoreError as e:
            typer.echo(f"Stats skipped: {e}")
        except Exception as e:  # stats never change the exit code; no message text (it can hold a token)
            typer.echo(f"Stats skipped: {type(e).__name__}")
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
        # Connected logins are checked when they post; this checks the GitHub-secret Meta tokens.
        # (with a Facebook connection the publisher ignores token_env, so it isn't checked either)
        if not used & {"facebook", "instagram"} or not account.token_env or "meta" in account.connected:
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
        typer.echo("SKIP telegram: not configured (needed for fb_profile, tiktok, youtube, shopee rows)")
    if problems:
        raise typer.Exit(1)


def _tokens(repo, cfg: Config, http: httpx.Client, now: datetime):
    """token(account, connection) -> access token: a saved login (refreshed near expiry) or, for Meta,
    the GitHub secret named by token_env. Each login is read and refreshed at most once per run, and a
    failure is remembered so later posts don't repeat the call (a repeated refresh could spend a token)."""
    cache: dict[tuple[str, str], str | PlatformError] = {}

    def token(account, kind: str) -> str:
        key = (account.name, kind)
        if key not in cache:
            try:
                cache[key] = lookup(account, kind)
            except PlatformError as e:
                cache[key] = e
        found = cache[key]
        if isinstance(found, PlatformError):
            raise found
        return found

    def lookup(account, kind: str) -> str:
        if kind in account.connected:
            try:
                found = repo.tokens(account.name, kind)
            except StoreError as e:
                raise PlatformError("transient", str(e)) from None
            if found is None:
                raise PlatformError("auth", f"{kind} login is missing: reconnect it on the Accounts page")
            tokens, expires_at = found
            if oauth.needs_refresh(expires_at, now):
                tokens, expires_at = oauth.refresh(http, kind, tokens.get("refresh_token", ""), cfg.env, now)
                try:
                    still_connected = repo.save_tokens(account.name, kind, tokens, expires_at)
                except StoreError:
                    # X rotates refresh tokens: post now with the new one; the next run asks to reconnect.
                    typer.echo(
                        f"Couldn't save the refreshed {kind} login for account {account.name}", err=True
                    )
                else:
                    if not still_connected:
                        raise PlatformError("auth", f"{kind} was disconnected while posting: not posted")
            return tokens["access_token"]
        if kind == "meta" and account.token_env:
            value = cfg.env.get(account.token_env)
            if not value:
                raise PlatformError("auth", f"{account.token_env} is not set (add it as a GitHub secret)")
            return value
        raise PlatformError(
            "auth", f"No {kind} login for account {account.name}: connect it on the Accounts page"
        )

    return token


def _nudge_if_empty(repo, cfg: Config, http: httpx.Client, now: datetime) -> None:
    """Once a day, on the first run after PP_NUDGE_HOUR, tell Telegram if nothing is planned or done today."""
    window = nudge_window(now, getattr(repo, "timezone", DEFAULT_TIMEZONE), cfg.nudge_hour)
    if not window:
        return
    day, start, end = window
    try:
        # Claim before sending: a failed send loses one reminder, never sends two.
        if repo.count_live_between(start, end) == 0 and repo.claim_nudge(day):
            link = f" {cfg.web_app_url}/#/new" if cfg.web_app_url else ""
            telegram.send_text(
                http, cfg.telegram_bot_token, cfg.telegram_chat_id, f"Nothing posted today yet.{link}"
            )
    except (StoreError, PlatformError) as e:
        typer.echo(f"Nudge skipped: {e}")  # a missed reminder must never fail the publish run
