from dataclasses import replace

from postpilot.models import ACCOUNT_COLUMNS, COMMENT_COLUMN, POST_COLUMNS, Account, Post
from postpilot.sheet import accounts_from_values, posts_from_values


class FakeRepository:
    """In-memory Posts/Accounts tabs that go through the same parsing as the real sheet."""

    def __init__(
        self,
        posts: list[dict[str, str]],
        accounts: list[dict[str, str]],
        connected: dict[str, set[str]] | None = None,
    ):
        # Supabase-only columns too, so runner tests can exercise first comments.
        cols = [*POST_COLUMNS, "first_comment", *COMMENT_COLUMN.values()]
        self.posts = [cols] + [[p.get(c, "") for c in cols] for p in posts]
        self.accounts = [list(ACCOUNT_COLUMNS)] + [[a.get(c, "") for c in ACCOUNT_COLUMNS] for a in accounts]
        self.connected = connected or {}  # account name -> saved logins, like Supabase `connections`
        self.writes: list[dict[int, dict[str, str]]] = []

    def load(self) -> tuple[list[Post], dict[str, Account]]:
        accounts = {
            name: replace(a, connected=frozenset(self.connected.get(name, ())))
            for name, a in accounts_from_values(self.accounts).items()
        }
        return posts_from_values(self.posts), accounts

    def write(self, updates: dict[int, dict[str, str]]) -> None:
        self.writes.append(updates)
        header = self.posts[0]
        for row, fields in updates.items():
            for col, value in fields.items():
                self.posts[row - 1][header.index(col)] = value

    def claim(self, claims: dict[int, dict[str, str]]) -> dict[int, Post]:
        """Claims only rows still scheduled/partial (like the Supabase filter) and returns them fresh."""
        status = self.posts[0].index("status")
        ok = {r: f for r, f in claims.items() if self.posts[r - 1][status] in ("scheduled", "partial")}
        if ok:
            self.write(ok)
        fresh = {p.row: p for p in self.load()[0]}
        return {r: fresh[r] for r in ok}

    def row(self, row: int) -> dict[str, str]:
        return dict(zip(self.posts[0], self.posts[row - 1], strict=True))
