# Connect and Post Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect buttons (Facebook+IG, X, TikTok) and automatic posting to X and TikTok; Shopee by hand.

**Architecture:** Edge Function `connect` runs OAuth and saves tokens to Supabase Vault through service-role SQL
functions. The Python publisher reads/refreshes tokens through the repository and hands only the token to adapters.

**Tech Stack:** Python 3.12 + httpx, Supabase (Postgres, Vault, Edge Functions/Deno), React + TS.

**Spec:** `docs/superpowers/specs/2026-10-28-connect-and-post-design.md`

## Global Constraints
- No new dependencies. Tests never call real APIs (httpx.MockTransport, FakeRepository).
- Never log or surface tokens or raw httpx messages.
- Idempotency: a filled platform ID column = never publish that platform again; write it right after success.
- Mirrors: `validation.py` ↔ `web/src/validation.ts`, `models.py` platform lists ↔ `web/src/types.ts`.
- Schema: new migration file, RLS owner-only, token functions executable by `service_role` only.

## Review Focus
- TikTok post sent to Telegram, then account connects TikTok: must not post again (`tiktok_id='telegram'`).
- X refresh succeeds but saving the new tokens fails: report "reconnect X", never post with stale tokens silently.
- X post with emoji/URLs near 280: weighted count matches X (test in both mirrors).
- TikTok upload times out after the bytes were sent: outcome `unknown`, not retried.
- Account with legacy `token_env` and a Meta connection: connection token is used.

---

### Task 1: Schema
**Files:** Create `supabase/migrations/20261028000000_connections.sql`
- [ ] posts: add `x_post_id, x_permalink, tiktok_id, tiktok_permalink` (text, default ''); replace platforms check
  with `x`, `shopee` added; backfill `tiktok_id='telegram'` where `tg_message_id<>''` and tiktok in platforms.
- [ ] `connections(id, owner_id, account_id → accounts on delete cascade, platform in ('meta','x','tiktok'), handle,
  secret_id uuid, expires_at, connected_at, unique(account_id, platform))`, RLS select/delete own.
- [ ] `oauth_states(state pk, owner_id, account_id, platform, verifier, created_at)`, RLS on, no policies.
- [ ] `save_connection(p_account bigint, p_platform text, p_handle text, p_tokens text, p_expires_at timestamptz)`,
  `connection_tokens(p_account bigint, p_platform text) returns table(tokens text, expires_at timestamptz)`,
  delete trigger removing the Vault secret. Security definer, `search_path=''`, execute revoked from public,
  granted to service_role.
- [ ] Apply to `wsclesrylegjsyfxaamr`; verify an authenticated user can't call the functions.

### Task 2: Publisher models, runner, validation
**Files:** `models.py`, `runner.py`, `validation.py`, `telegram.py`; tests `test_runner.py`, `test_validation.py`, `test_models.py`
**Produces:** `X="x"`, `TIKTOK="tiktok"`, `SHOPEE="shopee"`; `ID_COLUMN` adds x→`x_post_id`, tiktok→`tiktok_id`;
`Account.connected: frozenset[str] = frozenset()`; `Account.by_api(platform) -> bool`; `x_length(text) -> int`.
- [ ] Tests: runner sends tiktok to adapter when connected, to Telegram otherwise and saves `tiktok_id='telegram'`;
  `done("tiktok")` true for `'telegram'`; validation messages for X (not connected, too long, video), Meta token
  via connection, Shopee assist length.
- [ ] Implement; `python -m uv run pytest -q` green.

### Task 3: Adapters and token refresh
**Files:** Create `rest.py`, `x.py`, `tiktok.py`, `oauth.py`; tests `test_x.py`, `test_tiktok.py`, `test_oauth.py`
**Produces:** `rest.call(http, method, url, *, token, safe, classify, attempts=3, sleep=time.sleep, **kw) -> dict`;
`x.publish(http, token, post) -> PublishResult`; `tiktok.publish(http, token, post, privacy, sleep, checks) -> PublishResult`;
`oauth.refresh(http, platform, refresh_token, env) -> tuple[dict, str]` (tokens, expires_at ISO).
- [ ] Tests: X text+link, X image upload then tweet, 402 → permanent "credits", 429 → rate, timeout on tweet →
  unknown; TikTok init → PUT → status PUBLISH_COMPLETE, FAILED → permanent, PUT timeout → unknown; refresh both.

### Task 4: Repository + CLI wiring
**Files:** `supabase_repo.py`, `cli.py`, `config.py`, `.github/workflows/publish.yml`, `.env.example`; tests
**Produces:** `SupabaseRepository.tokens(account, platform) -> dict | None` (refreshing when < 5 min left and saving).
- [ ] Load `connections` into `Account.connected`; publishers for x, tiktok; Meta uses connection then `token_env`.

### Task 5: Edge Function `connect`
**Files:** Create `supabase/functions/connect/index.ts`; deploy with verify_jwt false (checks the user itself).

### Task 6: Web
**Files:** `types.ts`, `validation.ts`, `content.ts`?, `postView.ts`, `Accounts.tsx`, `Composer.tsx`, `Handoff.tsx`, tests
- [ ] Platforms x, shopee; connect/disconnect buttons; `?connected=`/`?error=` notice; X counter; tests green; build.

### Task 7: Docs, PR
- [ ] PROGRESS.md go-live steps (developer apps, redirect URIs, secrets); PR; `@codex review`.
