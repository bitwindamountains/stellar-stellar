from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol

from postpilot.config import Config
from postpilot.models import (
    ASSISTED_PLATFORMS,
    COMMENT_COLUMN,
    FINISH_IN_APP,
    ID_COLUMN,
    PERMALINK_COLUMN,
    SENT_BY_HAND,
    Account,
    PlatformError,
    Post,
    PublishResult,
)
from postpilot.selector import select
from postpilot.validation import validate

Publisher = Callable[[Post, Account], PublishResult]
Assist = Callable[[Post, list[str]], str]
Commenter = Callable[[Post, Account, str], str]  # (post, account, the platform's post ID) -> comment ID


class Repository(Protocol):
    def load(self) -> tuple[list[Post], dict[str, Account]]: ...
    def write(self, updates: dict[int, dict[str, str]]) -> None: ...
    def claim(self, claims: dict[int, dict[str, str]]) -> dict[int, Post]:
        """Set rows to `posting` only if still scheduled/partial; return the claimed rows as stored now."""
        ...


@dataclass
class Report:
    posted: list[int] = field(default_factory=list)
    partial: list[int] = field(default_factory=list)
    failed: list[int] = field(default_factory=list)
    missed: list[int] = field(default_factory=list)
    lines: list[str] = field(default_factory=list)


def run(
    repo: Repository,
    publishers: dict[str, Publisher],
    assist: Assist | None,
    cfg: Config,
    now: datetime,
    dry_run: bool = False,
    commenters: dict[str, Commenter] | None = None,
) -> Report:
    report = Report()
    stamp = now.isoformat(timespec="seconds")
    claim = repo.claim
    commenters = commenters or {}
    if dry_run:
        write = lambda updates: None  # noqa: E731
        publishers = {name: (lambda post, account: PublishResult("dry-run", "")) for name in publishers}
        assist = lambda post, platforms: "dry-run"  # noqa: E731
        commenters = {name: (lambda post, account, object_id: "dry-run") for name in commenters}
    else:
        write = repo.write

    posts, accounts = repo.load()
    s = select(
        posts,
        accounts,
        now,
        grace_minutes=cfg.late_grace_minutes,
        max_attempts=cfg.max_attempts,
        stale_minutes=cfg.stale_posting_minutes,
        limit=cfg.max_posts_per_run,
    )

    # One batch: close out rows that won't publish, then claim the due ones.
    updates: dict[int, dict[str, str]] = {}
    for post in s.missed:
        why = f"Not posted: more than {cfg.late_grace_minutes} minutes late. Edit it to post now or later."
        updates[post.row] = {"status": "missed", "last_error": why}
        report.missed.append(post.row)
    for post, kind in [(p, "permanent") for p in s.exhausted] + [(p, "unknown") for p in s.stale]:
        # Live everywhere, only first comments left: the post is out, so it's posted (comment by hand).
        comments = [p for p in post.platforms if post.comment_pending(p)]
        if comments and all(post.done(p) for p in post.platforms):
            notes = "; ".join(_comment_note(p, kind) for p in comments)
            updates[post.row] = {"status": "posted", "posted_at": stamp, "last_error": notes}
            report.posted.append(post.row)
        elif kind == "permanent":
            why = f"Gave up after {post.get('attempts') or 0} attempt(s). {post.get('last_error')}".strip()
            updates[post.row] = {"status": "failed", "last_error": why}
            report.failed.append(post.row)
        else:
            pending = [p for p in post.platforms if not post.done(p)]
            why = f"Run stopped while posting. Check {', '.join(pending)}, then reschedule if it's missing."
            updates[post.row] = {"status": "failed", "last_error": why}
            report.failed.append(post.row)
    for post, errors in s.invalid:
        updates[post.row] = {"status": "failed", "last_error": "; ".join(errors)}
    report.failed += [p.row for p, _ in s.invalid]
    if updates:
        write(updates)

    claims = {}
    for post in s.due:
        attempts = str(int(post.get("attempts") or 0) + 1)
        claims[post.row] = {"status": "posting", "attempts": attempts, "claimed_at": stamp, "last_error": ""}
    if dry_run:
        claimed = {p.row: p for p in s.due}
    else:
        claimed = claim(claims) if claims else {}

    for post in s.due:
        # The app may have edited or deleted the post since loading: publish what's stored now, or nothing.
        fresh = claimed.get(post.row)
        if fresh is None:
            report.lines.append(f"row {post.row}: skipped: changed or deleted while the run started")
            continue
        errors = validate(fresh, accounts)
        if errors:
            failed = {"status": "failed", "last_error": "; ".join(errors)}
            write({post.row: failed})
            updates[post.row] = failed
            report.failed.append(post.row)
            continue
        _publish_row(
            fresh,
            accounts[fresh.get("account")],
            publishers,
            assist,
            commenters,
            write,
            cfg,
            stamp,
            report,
            dry_run,
        )
    for row, fields in sorted(updates.items()):
        if fields["status"] in ("missed", "failed", "posted"):
            report.lines.append(f"row {row}: {fields['status']}: {fields['last_error']}")
    return report


def _comment_note(platform: str, kind: str) -> str:
    name = platform.capitalize()
    if kind == "auth":
        return f"Comment not added on {name}: reconnect Meta in Accounts to allow comments"
    if kind == "unknown":
        return f"Comment on {name} may not have been added: check, and add it by hand if missing"
    return f"Comment not added on {name}: add it by hand"


def _publish_row(post, account, publishers, assist, commenters, write, cfg, stamp, report, dry_run) -> None:
    def save(fields: dict[str, str]) -> None:
        post.cells.update(fields)
        write({post.row: fields})  # immediately: a filled ID is what stops a repost

    errors: list[tuple[str, PlatformError]] = []
    done_now: list[str] = []
    for platform in post.platforms:
        if not account.by_api(platform) or post.done(platform):
            continue
        try:
            result = publishers[platform](post, account)
        except PlatformError as e:
            errors.append((platform, e))
            continue
        except Exception as e:  # never surface raw text: it may contain URLs with tokens
            errors.append(
                (platform, PlatformError("unknown", f"Unexpected {type(e).__name__}; check if it posted"))
            )
            continue
        save({ID_COLUMN[platform]: result.id, PERMALINK_COLUMN[platform]: result.permalink})
        done_now.append(platform)

    # First comments: once per platform, only after its post is out. Failures never undo a live post.
    comment_errors: list[tuple[str, PlatformError]] = []
    for platform in post.platforms:
        if not (account.by_api(platform) and platform in commenters and post.comment_pending(platform)):
            continue
        try:
            comment_id = commenters[platform](post, account, post.get(ID_COLUMN[platform]))
        except PlatformError as e:
            comment_errors.append((platform, e))
            continue
        except Exception as e:  # never surface raw text: it may contain URLs with tokens
            unexpected = PlatformError("unknown", f"Unexpected {type(e).__name__}; check if it was added")
            comment_errors.append((platform, unexpected))
            continue
        save({COMMENT_COLUMN[platform]: comment_id})
        done_now.append(f"{platform} comment")

    def needs_you(p: str) -> bool:
        if account.by_api(p):
            # A draft (TikTok inbox) still needs its caption on your phone: once, right after the upload.
            # ponytail: if that send fails after an earlier message went out, only the handoff page has it.
            return p in FINISH_IN_APP and post.done(p) and (p in done_now or not post.get("tg_message_id"))
        return p in ASSISTED_PLATFORMS and not post.done(p)

    assisted = [p for p in post.platforms if needs_you(p)]
    if assisted:
        if assist is None:
            errors.append(
                ("telegram", PlatformError("permanent", "Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID"))
            )
        else:
            try:
                by_hand = {
                    ID_COLUMN[p]: SENT_BY_HAND for p in assisted if p in ID_COLUMN and not post.done(p)
                }
                save({"tg_message_id": assist(post, assisted), **by_hand})
                done_now += [p for p in assisted if p not in done_now]
            except PlatformError as e:
                errors.append(("telegram", e))

    attempts_left = int(post.get("attempts") or 0) < cfg.max_attempts  # empty in a dry run (no claim)
    # A partial retries every pending comment, so it's only safe when no comment outcome is unclear/final.
    comments_retryable = all(e.retryable for _, e in comment_errors)
    if errors:
        retry = all(e.retryable for _, e in errors) and comments_retryable and attempts_left
        failures = errors + [(f"{p} comment", e) for p, e in comment_errors]
        message = "; ".join(f"{platform}: {e}" for platform, e in failures)
        final = {"status": "partial" if retry else "failed", "last_error": message}
        (report.partial if retry else report.failed).append(post.row)
    elif comment_errors and comments_retryable and attempts_left:
        message = "; ".join(f"{p} comment: {e}" for p, e in comment_errors)
        final = {"status": "partial", "last_error": message}
        report.partial.append(post.row)
    else:
        notes = "; ".join(_comment_note(p, e.kind) for p, e in comment_errors)
        final = {"status": "posted", "posted_at": stamp, "last_error": notes}
        report.posted.append(post.row)
    write({post.row: final})
    verb = "would publish" if dry_run else "published"
    line = f"row {post.row}: {final['status']}"
    if done_now:
        line += f" ({verb} {', '.join(done_now)})"
    if final["last_error"]:
        line += f": {final['last_error']}"
    report.lines.append(line)
