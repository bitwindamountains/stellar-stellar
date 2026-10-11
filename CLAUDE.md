# PostPilot
Google Sheet content calendar -> Facebook Page + Instagram publishing via Meta Graph API, plus Telegram
"assist" messages for platforms without API access (personal FB profile, TikTok, YouTube). Run by GitHub Actions.

Scope: docs/ideas/postpilot.md. Task list + design decisions: tasks/plan.md. Detail: 04_PostPilot_Blueprint.md
(where it disagrees with the plan, the plan wins).

## Commands (uv is installed as a Python module here)
- Install: `python -m uv sync`
- Test: `python -m uv run pytest -q`
- Lint/format: `python -m uv run ruff check . --fix && python -m uv run ruff format .`
- Dry run: `python -m uv run --env-file .env postpilot publish --dry-run`

## Rules
- Never publish for real while developing unless I explicitly say so; default to --dry-run.
- Idempotency is sacred: a filled platform ID (or tg_message_id) means never publish that platform again for that row.
- Write each platform's ID back immediately after it succeeds.
- A stale `posting` row becomes `failed`, never auto-retried.
- Runner must not know Graph API details; adapters must not know about Sheets.
- Never print or log tokens or the service-account JSON. Accounts tab stores secret names only.
  httpx errors can contain URLs; the Telegram bot token is in its URL, so never surface raw httpx messages.
- Tests never call real APIs: use httpx.MockTransport and FakeRepository.
- Don't add dependencies without asking.
