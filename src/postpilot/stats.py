from collections.abc import Callable
from datetime import datetime, timedelta

from postpilot.models import ID_COLUMN, SENT_BY_HAND, Account, PlatformError, Post

Fetcher = Callable[[Post, Account, str], dict]


def top(comments: list[dict], n: int = 5) -> list[dict]:
    """Most liked first, newest first among equals."""
    by_newest = sorted(comments, key=lambda c: c.get("at") or "", reverse=True)
    return sorted(by_newest, key=lambda c: c.get("likes") or 0, reverse=True)[:n]


def refresh(repo, fetchers: dict[str, Fetcher], now: datetime, days: int = 7, limit: int = 20) -> list[str]:
    """Re-fetch stats for recent posts; a failed platform keeps its old numbers. StoreError propagates."""
    lines: list[str] = []
    as_of = now.isoformat(timespec="seconds")
    for post in repo.recent_posted(now - timedelta(days=days))[:limit]:
        stats = dict(post.stats)
        changed = False
        for platform, fetch in fetchers.items():
            object_id = post.get(ID_COLUMN[platform])
            if not object_id or object_id == SENT_BY_HAND:
                continue
            try:
                fresh = fetch(post, repo.accounts[post.get("account")], object_id)
            except PlatformError as e:
                lines.append(f"row {post.row}: stats skipped on {platform} ({e.kind})")
                continue
            stats[platform] = {**fresh, "top_comments": top(fresh.get("top_comments", [])), "as_of": as_of}
            changed = True
        if changed:
            repo.save_stats(post.row, stats)
    return lines
