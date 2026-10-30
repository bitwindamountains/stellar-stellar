import time
from collections.abc import Callable
from datetime import datetime, timedelta

from postpilot.models import ID_COLUMN, SENT_BY_HAND, Account, PlatformError, Post

Fetcher = Callable[[Post, Account, str], dict]


def top(comments: list[dict], n: int = 5) -> list[dict]:
    """Most liked first, newest first among equals."""
    by_newest = sorted(comments, key=lambda c: c.get("at") or "", reverse=True)
    return sorted(by_newest, key=lambda c: c.get("likes") or 0, reverse=True)[:n]


def refresh(
    repo,
    fetchers: dict[str, Fetcher],
    now: datetime,
    days: int = 7,
    limit: int = 20,
    budget_s: float = 60,
    clock: Callable[[], float] = time.monotonic,
) -> list[str]:
    """Re-fetch stats for recent posts; a failed platform keeps its old numbers. StoreError from the
    repo propagates. Stops starting new posts once budget_s is spent so stats never stall a run."""
    lines: list[str] = []
    as_of = now.isoformat(timespec="seconds")
    start = clock()
    for done, post in enumerate(repo.recent_posted(now - timedelta(days=days))[:limit]):
        if clock() - start >= budget_s:
            lines.append(f"stats: stopped after {done} post(s), time budget reached")
            break
        stats = dict(post.stats)
        changed = False
        for platform, fetch in fetchers.items():
            object_id = post.get(ID_COLUMN[platform])
            if not object_id or object_id == SENT_BY_HAND:
                continue
            try:
                fresh = fetch(post, repo.accounts[post.get("account")], object_id)
            except Exception as e:  # stats are best effort; never the message (it can hold a token)
                kind = e.kind if isinstance(e, PlatformError) else type(e).__name__
                lines.append(f"row {post.row}: stats skipped on {platform} ({kind})")
                continue
            stats[platform] = {**fresh, "top_comments": top(fresh.get("top_comments", [])), "as_of": as_of}
            changed = True
        if changed:
            repo.save_stats(post.row, stats)
    return lines
