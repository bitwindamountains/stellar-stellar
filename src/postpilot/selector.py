from dataclasses import dataclass, field
from datetime import datetime, timedelta

from postpilot.models import Account, Post
from postpilot.timeutil import parse_local
from postpilot.validation import validate


@dataclass
class Selection:
    due: list[Post] = field(default_factory=list)
    missed: list[Post] = field(default_factory=list)  # scheduled, too late to post
    exhausted: list[Post] = field(default_factory=list)  # partial, out of attempts or too late
    stale: list[Post] = field(default_factory=list)  # stuck in `posting`: a run died mid-publish
    invalid: list[tuple[Post, list[str]]] = field(default_factory=list)


def select(
    posts: list[Post],
    accounts: dict[str, Account],
    now: datetime,
    *,
    grace_minutes: int,
    max_attempts: int,
    stale_minutes: int,
    limit: int,
) -> Selection:
    s = Selection()
    due: list[tuple[datetime, Post]] = []
    for post in posts:
        status = post.get("status").lower()
        if status == "posting":
            try:
                claimed = datetime.fromisoformat(post.get("claimed_at"))
                stale = now - claimed > timedelta(minutes=stale_minutes)
            except (ValueError, TypeError):
                stale = True
            if stale:
                s.stale.append(post)
            continue
        if status not in ("scheduled", "partial"):
            continue
        errors = validate(post, accounts)
        if errors:
            s.invalid.append((post, errors))
            continue
        when = parse_local(post.get("publish_at"), accounts[post.get("account")].timezone)
        if when > now:
            continue
        late = now - when > timedelta(minutes=grace_minutes)
        if status == "partial" and (late or _attempts(post) >= max_attempts):
            s.exhausted.append(post)
        elif late:
            s.missed.append(post)
        else:
            due.append((when, post))
    due.sort(key=lambda item: (item[0], item[1].row))
    s.due = [post for _, post in due[:limit]]
    return s


def _attempts(post: Post) -> int:
    try:
        return int(post.get("attempts") or 0)
    except ValueError:
        return 0
