import json
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

from postpilot.models import DEFAULT_TIMEZONE, Account, Post, StoreError

# Statuses the publisher and `validate` act on; finished posts are never loaded.
ACTIVE = "(draft,scheduled,partial,posting)"
TIMESTAMPS = ("claimed_at", "posted_at")
INTEGERS = ("attempts",)


class SupabaseRepository:
    """Posts and accounts over Supabase's REST API, shaped like sheet rows so the runner stays unchanged.

    Uses the service-role key (bypasses RLS). The key travels in headers only, never in URLs or errors.
    """

    def __init__(self, url: str, service_key: str, http: httpx.Client | None = None):
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}
        self.http = http or httpx.Client(timeout=30)
        self.timezone = DEFAULT_TIMEZONE  # set from the first account on load; used for the daily nudge
        self.accounts: dict[str, Account] = {}

    def load(self) -> tuple[list[Post], dict[str, Account]]:
        rows = self._request(
            "GET", "accounts", params={"select": "id,fb_page_id,ig_user_id,token_env,timezone"}
        )
        connected: dict[str, set[str]] = {}
        for c in self._request("GET", "connections", params={"select": "account_id,platform"}):
            connected.setdefault(str(c["account_id"]), set()).add(c["platform"])
        accounts = {
            str(a["id"]): Account(
                str(a["id"]),
                a["fb_page_id"],
                a["ig_user_id"],
                a["token_env"],
                a["timezone"],
                frozenset(connected.get(str(a["id"]), ())),
            )
            for a in rows
        }
        if accounts:
            self.timezone = next(iter(accounts.values())).timezone
        self.accounts = accounts
        rows = self._request("GET", "posts", params={"select": "*", "status": f"in.{ACTIVE}", "order": "num"})
        return [Post(row=r["num"], cells=_to_cells(r, accounts)) for r in rows], accounts

    def write(self, updates: dict[int, dict[str, str]]) -> None:
        for num, fields in updates.items():
            self._request("PATCH", "posts", params={"num": f"eq.{num}"}, json=_from_cells(fields))

    def claim(self, claims: dict[int, dict[str, str]]) -> dict[int, Post]:
        """Claim a row only if still scheduled/partial, so an edit or delete from the app wins the race."""
        claimed = {}
        for num, fields in claims.items():
            rows = self._request(
                "PATCH",
                "posts",
                params={"num": f"eq.{num}", "status": "in.(scheduled,partial)", "select": "*"},
                json=_from_cells(fields),
                returning=True,
            )
            if rows:
                claimed[num] = Post(row=num, cells=_to_cells(rows[0], self.accounts))
        return claimed

    def count_live_between(self, start: datetime, end: datetime) -> int:
        """Posts planned or done in [start, end). Failed and missed ones don't count."""
        params = [
            ("select", "num"),
            ("publish_at", f"gte.{start.isoformat()}"),
            ("publish_at", f"lt.{end.isoformat()}"),
            ("status", "not.in.(failed,missed)"),
        ]
        return len(self._request("GET", "posts", params=params))

    def tokens(self, account: str, platform: str) -> tuple[dict, str] | None:
        """A saved login's tokens (decrypted from Vault) and expiry ('' = never), or None if not connected."""
        rows = self._request(
            "POST",
            "rpc/connection_tokens",
            json={"p_account": int(account), "p_platform": platform},
            returning=True,
        )
        if not rows:
            return None
        try:
            tokens = json.loads(rows[0]["tokens"])
        except (TypeError, ValueError):
            raise StoreError(f"Saved {platform} login is unreadable: reconnect it") from None
        return tokens, rows[0]["expires_at"] or ""

    def save_tokens(self, account: str, platform: str, tokens: dict, expires_at: str) -> bool:
        """Store refreshed tokens. False = the login was disconnected meanwhile (it is not re-created)."""
        return (
            self._request(
                "POST",
                "rpc/update_connection_tokens",
                json={
                    "p_account": int(account),
                    "p_platform": platform,
                    "p_tokens": json.dumps(tokens),
                    "p_expires_at": expires_at or None,
                },
                returning=True,
            )
            is True
        )

    def record_run(self, **counts) -> None:
        self._request("POST", "runs", json=counts)

    def _request(
        self,
        method: str,
        table: str,
        params: dict | list | None = None,
        json: dict | None = None,
        returning=False,
    ):
        prefer = "return=representation" if returning else "return=minimal"
        headers = {**self.headers, "Prefer": prefer} if method != "GET" else self.headers
        try:
            r = self.http.request(method, f"{self.base}/{table}", params=params, json=json, headers=headers)
        except httpx.TransportError:
            raise StoreError("Couldn't reach Supabase (network problem)") from None
        if r.is_success:
            return r.json() if method == "GET" or returning else None
        try:
            message = r.json().get("message", "")
        except ValueError:
            message = ""
        raise StoreError(f"Supabase {r.status_code} on {table}: {message or 'request failed'}")


def _to_cells(row: dict, accounts: dict[str, Account]) -> dict[str, str]:
    cells = {k: "" if v is None else str(v) for k, v in row.items() if not isinstance(v, (list, dict))}
    cells["variants"] = json.dumps(row.get("variants") or {})
    cells["account"] = str(row["account_id"])
    cells["platforms"] = ",".join(row["platforms"])
    cells["media_urls"] = "\n".join(row["media_urls"])
    account = accounts.get(cells["account"])
    if row["publish_at"] and account:
        try:
            local = datetime.fromisoformat(row["publish_at"]).astimezone(ZoneInfo(account.timezone))
            cells["publish_at"] = local.strftime("%Y-%m-%d %H:%M")
        except (ZoneInfoNotFoundError, ValueError):
            pass  # validation reports the bad time zone
    return cells


def _from_cells(fields: dict[str, str]) -> dict:
    out: dict = {}
    for key, value in fields.items():
        if key in INTEGERS:
            out[key] = int(value or 0)
        elif key in TIMESTAMPS:
            out[key] = value or None
        else:
            out[key] = value
    return out
