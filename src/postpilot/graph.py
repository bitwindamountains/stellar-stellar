import time
from collections.abc import Callable

import httpx

from postpilot.models import PlatformError

BASE_URL = "https://graph.facebook.com"
RATE_CODES = {4, 17, 32, 613}
TRANSIENT_CODES = {1, 2}
IG_PUBLISH_LIMIT_SUBCODE = 2207042
UNKNOWN_OUTCOME = "No clear answer from Meta while publishing: check if it posted, then reschedule"


def classify(status: int, body: dict) -> PlatformError:
    error = body.get("error") or {}
    code, subcode = error.get("code"), error.get("error_subcode")
    message = error.get("message") or f"HTTP {status}"
    if code == 190 or code == 10 or (isinstance(code, int) and 200 <= code <= 299):
        return PlatformError("auth", f"Meta token/permission problem, operator must fix it: {message}")
    if code in RATE_CODES or subcode == IG_PUBLISH_LIMIT_SUBCODE:
        return PlatformError("rate", f"Meta rate limit reached, will retry next run: {message}")
    if code in TRANSIENT_CODES or status >= 500:
        return PlatformError("transient", f"Meta had a temporary problem: {message}")
    if code == 368:
        return PlatformError("permanent", f"Meta temporarily blocked posting from this account: {message}")
    return PlatformError("permanent", f"Meta rejected the post: {message} (code {code})")


class GraphClient:
    """Thin Graph API client. The token goes in a header so it never appears in URLs or error text."""

    def __init__(
        self,
        version: str,
        token: str,
        http: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
        attempts: int = 3,
    ):
        self.base = f"{BASE_URL}/{version}"
        self.headers = {"Authorization": f"Bearer {token}"}
        self.http = http or httpx.Client(timeout=30)
        self.sleep = sleep
        self.attempts = attempts

    def get(self, path: str, **params: str) -> dict:
        return self._request("GET", path, params, safe=True)

    def post(self, path: str, *, safe: bool, **data: str) -> dict:
        """safe=False for publishing calls: never retried; unclear outcomes become `unknown`."""
        return self._request("POST", path, data, safe=safe)

    def _request(self, method: str, path: str, fields: dict, safe: bool) -> dict:
        for attempt in range(1, self.attempts + 1):
            try:
                kwargs = {"params": fields} if method == "GET" else {"data": fields}
                response = self.http.request(method, f"{self.base}/{path}", headers=self.headers, **kwargs)
            except httpx.TransportError:
                error = PlatformError("transient", "Couldn't reach Meta (network problem)")
            else:
                if response.is_success:
                    return response.json()
                try:
                    body = response.json()
                except ValueError:
                    body = {}
                error = classify(response.status_code, body)
            if error.kind != "transient":
                raise error
            if not safe:
                raise PlatformError("unknown", UNKNOWN_OUTCOME)
            if attempt < self.attempts:
                self.sleep(2**attempt)
        raise error


def fetch_permalink(graph: GraphClient, object_id: str, field: str) -> str:
    # The post is already live here; losing its ID over a permalink hiccup would cause a repost.
    try:
        return graph.get(object_id, fields=field).get(field, "")
    except PlatformError:
        return ""


def insight(graph, path: str, metric: str) -> int | None:
    """One insights call per metric, so a retired metric only loses itself (key absent)."""
    try:
        item = graph.get(f"{path}/insights", metric=metric)["data"][0]
        return int(item["total_value"]["value"] if "total_value" in item else item["values"][0]["value"])
    except (PlatformError, KeyError, IndexError, TypeError, ValueError):
        return None
