import time
from collections.abc import Callable

import httpx

from postpilot.models import PlatformError

# classify(status, body) -> PlatformError for a non-success answer; body is {} when it isn't JSON.
Classify = Callable[[int, dict], PlatformError]


def call(
    http: httpx.Client,
    method: str,
    url: str,
    *,
    service: str,
    classify: Classify,
    safe: bool,
    token: str = "",
    attempts: int = 3,
    sleep: Callable[[float], None] = time.sleep,
    **kwargs,
) -> dict:
    """One JSON API call. safe=False for publishing calls: never retried, unclear outcomes become `unknown`.

    The token goes in a header; httpx error text (which can hold URLs) is never passed on.
    """
    headers = {**kwargs.pop("headers", {}), **({"Authorization": f"Bearer {token}"} if token else {})}
    for attempt in range(1, attempts + 1):
        try:
            response = http.request(method, url, headers=headers, **kwargs)
        except httpx.TransportError:
            error = PlatformError("transient", f"Couldn't reach {service} (network problem)")
        else:
            try:
                body = response.json()
            except ValueError:
                body = {}
            if response.is_success:
                return body if isinstance(body, dict) else {}
            error = classify(response.status_code, body if isinstance(body, dict) else {})
        if error.kind != "transient":
            raise error
        if not safe:
            raise PlatformError(
                "unknown", f"No clear answer from {service} while publishing: check if it posted"
            )
        if attempt < attempts:
            sleep(2**attempt)
    raise error


def download(http: httpx.Client, url: str, service: str) -> tuple[bytes, str]:
    """Fetch the post's media so it can be uploaded. Returns (bytes, content type)."""
    try:
        response = http.get(url, follow_redirects=True, timeout=120)
    except httpx.TransportError:
        raise PlatformError("transient", f"Couldn't download the media for {service}") from None
    if not response.is_success:
        kind = "transient" if response.status_code >= 500 else "permanent"
        raise PlatformError(kind, f"Media link answered HTTP {response.status_code}: check it still opens")
    return response.content, response.headers.get("content-type", "").split(";")[0]
