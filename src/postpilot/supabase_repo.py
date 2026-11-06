import json
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

from postpilot.models import DEFAULT_TIMEZONE, Account, Post, StoreError

# Statuses the publisher and `validate` act on; finished posts are never loaded.
ACTIVE = "(draft,scheduled,partial,posting)"
TIMESTAMPS = ("claimed_at", "posted_at")
INTEGERS = ("attempts",)
# Uploads stay this long after posting: a Post again draft (kept only in the browser) may still use them.
KEEP_UPLOADS = timedelta(days=7)


class SupabaseRepository:
    """Posts and accounts over Supabase's REST API, as text cells so the runner stays store-agnostic.

    Uses the service-role key (bypasses RLS). The key travels in headers only, never in URLs or errors.
    """

    def __init__(self, url: str, service_key: str, http: httpx.Client | None = None):
        self.url = url.rstrip("/")
        self.base = self.url + "/rest/v1"
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

    def claim_nudge(self, day: date) -> bool:
        """Mark `day`'s nudge as sent. False if a run already did, so it goes out at most once a day."""
        try:
            r = self.http.post(
                f"{self.base}/nudges",
                json={"day": day.isoformat()},
                headers={**self.headers, "Prefer": "resolution=ignore-duplicates,return=representation"},
            )
        except httpx.TransportError:
            raise StoreError("Couldn't reach Supabase (network problem)") from None
        if not r.is_success:
            raise StoreError(f"Supabase {r.status_code} on nudges: request failed")
        return bool(r.json())

    def count_live_between(self, start: datetime, end: datetime) -> int:
        """Posts planned or done in [start, end). Failed and missed ones don't count."""
        params = [
            ("select", "num"),
            ("publish_at", f"gte.{start.isoformat()}"),
            ("publish_at", f"lt.{end.isoformat()}"),
            ("status", "not.in.(failed,missed)"),
        ]
        return len(self._request("GET", "posts", params=params))

    def recent_posted(self, since: datetime) -> list[Post]:
        """Posts that went live since `since`, newest first. Call after load() (needs the accounts)."""
        params = {
            "select": "*",
            "status": "eq.posted",
            "posted_at": f"gte.{since.isoformat()}",
            "order": "posted_at.desc",
        }
        rows = self._request("GET", "posts", params=params)
        return [Post(row=r["num"], cells=_to_cells(r, self.accounts)) for r in rows]

    def save_stats(self, num: int, stats: dict) -> None:
        self._request("PATCH", "posts", params={"num": f"eq.{num}"}, json={"stats": stats})

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

    def cleanup_media(self, now: datetime) -> None:
        """Delete our uploads that only finished posts (posted, nothing left to do by hand) still use, then
        drop the dead links. Every run sweeps, so a failed delete is retried. Any failure is skipped, never
        raised."""
        prefix = f"{self.url}/storage/v1/object/public/media/"
        select = "num,media_urls,cover_url,status,assist_done_at,tg_message_id"
        try:
            # ponytail: rows linking only to outside files stay in this sweep for good; fine for one person.
            rows = self._request(
                "GET",
                "posts",
                params={
                    "select": select,
                    "status": "eq.posted",
                    "posted_at": f"lt.{(now - KEEP_UPLOADS).isoformat()}",
                    # Handed off, or nothing went to Telegram; and it links to at least one file.
                    "and": "(or(assist_done_at.not.is.null,tg_message_id.eq.),"
                    "or(media_urls.neq.{},cover_url.neq.))",
                },
            )
            own = sorted({u for r in rows for u in _links(r) if u.startswith(prefix)})
            if not own:
                return
            # Every row using any of these files (group rows and Post again copies share them), in one query.
            quoted = ",".join(f'"{u}"' for u in own)
            users = self._request(
                "GET",
                "posts",
                params={"select": select, "or": f"(media_urls.ov.{{{quoted}}},cover_url.in.({quoted}))"},
            )
            used = {u for r in users if not _finished(r) for u in _links(r)}
            gone = [u for u in own if u not in used]
            if not gone:
                return
            r = self.http.request(
                "DELETE",
                f"{self.url}/storage/v1/object/media",
                json={"prefixes": [u[len(prefix) :] for u in gone]},
                headers=self.headers,
            )
            if not r.is_success:
                print("Storage cleanup skipped: the delete failed")
                return
            # Drop the dead links from every finished row, so Post again never reuses one.
            for target in {t["num"]: t for t in [*users, *rows] if _finished(t)}.values():
                patch = {"media_urls": [u for u in target["media_urls"] if u not in gone]}
                if (target["cover_url"] or "") in gone:
                    patch["cover_url"] = ""
                if patch["media_urls"] != target["media_urls"] or "cover_url" in patch:
                    params = {"num": f"eq.{target['num']}", "status": "eq.posted"}
                    self._request("PATCH", "posts", params=params, json=patch)
        except (StoreError, httpx.HTTPError, ValueError, KeyError, TypeError):
            print("Storage cleanup skipped")

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


def _links(row: dict) -> list[str]:
    return [*row["media_urls"], row["cover_url"] or ""]


def _finished(row: dict) -> bool:
    """Posted, and handed off or never sent by hand: it needs its files no more, so it must not keep them
    alive."""
    handed_off = bool(row.get("assist_done_at")) or not row.get("tg_message_id")
    return row.get("status") == "posted" and handed_off


def _to_cells(row: dict, accounts: dict[str, Account]) -> dict[str, str]:
    cells = {k: "" if v is None else str(v) for k, v in row.items() if not isinstance(v, (list, dict))}
    cells["variants"] = json.dumps(row.get("variants") or {})
    cells["stats"] = json.dumps(row.get("stats") or {})
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
