# PostPilot
Personal social posting: write once in a web/phone app, Facebook Page + Instagram publish automatically via the
Meta Graph API; personal FB profile, TikTok and YouTube go to Telegram + a phone handoff page to post by hand.

- **Publisher** (`src/postpilot/`, Python): GitHub Actions every 30 min (`.github/workflows/publish.yml`).
- **Store**: Supabase (`supabase/migrations/`) when `SUPABASE_URL` is set; the Google Sheet path is legacy.
- **App** (`web/`, Vite + React + TS PWA): queue, composer, handoff, accounts. Hosted on Cloudflare (planned).
- **dispatch** (`supabase/functions/dispatch/`): lets "Post now" start the publish workflow immediately.

Status and next steps: PROGRESS.md. Tasks + design decisions: tasks/plan.md. Ideas: docs/ideas/.
Original blueprint: 04_PostPilot_Blueprint.md (where it disagrees with the plan, the plan wins).

## Commands (uv is installed as a Python module on this machine; elsewhere plain `uv`)
- Publisher: `python -m uv sync` · `python -m uv run pytest -q` · `python -m uv run ruff check . && python -m uv run ruff format .`
- Dry run: `python -m uv run --env-file .env postpilot publish --dry-run` (real runs outside Actions need `--local`)
- Web (in `web/`): `npm run dev` · `npm test` · `npm run build` (runs `tsc --noEmit` first)
- Supabase project: `tfkazskwrarwbjdtlqed` (Seoul), shared with another app's `rentflow` schema: never touch `rentflow`.

## Rules
- Never publish for real while developing unless I explicitly say so; default to --dry-run.
- Idempotency is sacred: a filled platform ID (or tg_message_id) means never publish that platform again.
- Write each platform's ID back immediately after it succeeds.
- Claim posts with `repo.claim()`: Supabase only claims rows still scheduled/partial, and the runner publishes the
  row as stored after the claim (re-validated), never its stale in-memory copy.
- Publishing calls are never retried; unclear outcomes (`unknown`) and stale `posting` rows become `failed` for a
  human check. One-tap Retry is only offered when the post certainly didn't go out (`canRetry`).
- Runner must not know Graph API details; adapters must not know about the store.
- Web edits/deletes must not touch a post in `posting` (`.neq('status','posting')` + check for zero rows).
- Keep mirrors in step: `web/src/validation.ts` ↔ `validation.py`, `web/src/content.ts` ↔ `Post.text_for`.
- Telegram lengths are UTF-16 units, counted after HTML parsing. Instagram images must be JPEG.
- Never print or log tokens, the service-role key or the service-account JSON. Accounts store secret *names* only.
  httpx errors can contain URLs (the Telegram token is in its URL): never surface raw httpx messages.
- `web/` gets only the publishable key. The service-role key lives in GitHub secrets only.
- Schema changes: new file in `supabase/migrations/`, parse it, apply it, keep RLS owner-only.
- Tests never call real APIs: httpx.MockTransport, FakeRepository, mocked Supabase routes.
- Don't add dependencies without asking.
- Scripted file edits on this Windows machine: read/write with `encoding="utf-8"`, and write edit scripts with the
  Write tool (heredocs mangle `\n` escapes).
- Work on a branch, open a PR, wait for CI; Codex reviews PRs (comment `@codex review` to trigger).
