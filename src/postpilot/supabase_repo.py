import json
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

from postpilot.models import Account, Post, StoreError

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

    def load(self) -> tuple[list[Post], dict[str, Account]]:
        rows = self._request(
            "GET", "accounts", params={"select": "id,fb_page_id,ig_user_id,token_env,timezone"}
        )
        accounts = {
            str(a["id"]): Account(
                str(a["id"]), a["fb_page_id"], a["ig_user_id"], a["token_env"], a["timezone"]
            )
            for a in rows
        }
        rows = self._request("GET", "posts", params={"select": "*", "status": f"in.{ACTIVE}", "order": "num"})
        return [Post(row=r["num"], cells=_to_cells(r, accounts)) for r in rows], accounts

    def write(self, updates: dict[int, dict[str, str]]) -> None:
        for num, fields in updates.items():
            self._request("PATCH", "posts", params={"num": f"eq.{num}"}, json=_from_cells(fields))

    def record_run(self, **counts) -> None:
        self._request("POST", "runs", json=counts)

    def _request(self, method: str, table: str, params: dict | None = None, json: dict | None = None):
        headers = {**self.headers, "Prefer": "return=minimal"} if method != "GET" else self.headers
        try:
            r = self.http.request(method, f"{self.base}/{table}", params=params, json=json, headers=headers)
        except httpx.TransportError:
            raise StoreError("Couldn't reach Supabase (network problem)") from None
        if r.is_success:
            return r.json() if method == "GET" else None
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
