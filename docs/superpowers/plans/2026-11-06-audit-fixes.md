# Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the six findings of the 2026-11-06 repo audit: posts going out late, uploads never cleaned up,
runaway dispatches, two token stores, the dead Google Sheet path, and two Supabase security warnings.

**Architecture:** Starting the publish workflow early gets one owner, the SQL function `dispatch_due()`. Only it
holds the GitHub token (in Vault). The `dispatch` Edge Function calls it over RPC. Storage cleanup counts
automatic-only posts as finished. The publisher drops the Sheet store and runs on Supabase only.

**Tech Stack:** Python 3.12 + httpx + typer (publisher), Postgres/pg_cron/pg_net/Vault (Supabase project
`wsclesrylegjsyfxaamr`), Deno Edge Functions, Vite + React + TS (web).

**Spec:** the audit report in the 2026-11-06 session (findings 1-6). Each one is restated in its task below.

## Global Constraints

- Supabase project `wsclesrylegjsyfxaamr` only. Never touch `tfkazskwrarwbjdtlqed`.
- Never publish for real. Verification uses `--dry-run` or calls that find nothing due.
- Schema changes: a new file in `supabase/migrations/`, applied with `apply_migration`. RLS stays owner-only.
- Don't add dependencies. Task 4 *removes* `gspread` (approved as part of this plan).
- Never print or log tokens, the service-role key, or the GitHub token. Never echo GitHub's response body.
- Scripted edits: `encoding="utf-8"`, and edit scripts are written with the Write tool.
- Work on branch `fix/audit-2026-11-06`, one commit per task, then open a PR and wait for CI. Comment `@codex review`.
- Commands: `python -m uv run pytest -q`, `python -m uv run ruff check . && python -m uv run ruff format .`,
  in `web/`: `npm test`, `npm run build`. If `uv` fails with "trampoline failed", use `.venv/Scripts/python.exe -m pytest -q`.

## Review Focus

1. A posted automatic-only row whose file is still used by an unfinished group or Post again row keeps the file.
   Test in Task 2.
2. A TikTok draft row (`tg_message_id` set, no `assist_done_at`) keeps its file until "I posted it". Test in Task 2.
3. A post that came due more than 3 hours ago never makes the timer call GitHub again. SQL check in Task 3.
4. "Post now" while the GitHub token is missing still saves fine and returns no error to the app. Check in Task 3.
5. Without `SUPABASE_URL`, `postpilot publish` fails with a message naming `SUPABASE_URL` and showing no values.
   Test in Task 4.

---

### Task 1: Put the GitHub token in Vault (manual, by the user)

Finding 1: the 10-minute timer has no token, so posts wait for GitHub's 4-10 hour schedule and get marked missed.
No code. Do this **after Task 3 is applied**, so the token is only ever stored in one place.

- [ ] **Step 1:** GitHub → Settings → Developer settings → Fine-grained tokens → New. Repository:
  `bitwindamountains/PostPilot` only. Permission: Actions = Read and write. Expiry: 1 year (put a reminder in your calendar).
- [ ] **Step 2:** Supabase SQL editor (project `wsclesrylegjsyfxaamr`):
  `select vault.create_secret('<token>', 'postpilot_github_token');`
  Type the token only in the dashboard, never in chat or a file.
- [ ] **Step 3: Verify (read-only):**
  `select count(*) from vault.secrets where name = 'postpilot_github_token';` → `1`.
- [ ] **Step 4:** Do not set `GITHUB_TOKEN`/`GITHUB_REPO` on the `dispatch` function. After Task 3 it doesn't read them.

### Task 2: Clean up uploads of automatic-only posts

Finding 2: `_finished` needs `assist_done_at`, which only "I posted it" sets, so files from posts that went out
only to Facebook, Instagram or X are never deleted.

**Files:**
- Modify: `src/postpilot/supabase_repo.py` (`cleanup_media` sweep query and `select`, `_finished`)
- Modify: `web/src/actions.ts:55`, `web/src/screens/Composer.tsx:338`, `web/src/actions.test.ts:50` (note wording)
- Test: `tests/test_supabase_repo.py`

**Interfaces:**
- Produces: `_finished(row: dict) -> bool`, which is true when `status == "posted"` and
  (`assist_done_at` is set **or** `row.get("tg_message_id", "") == ""`).

- [ ] **Step 1: Write the failing tests** in `tests/test_supabase_repo.py`:
  - `test_cleanup_deletes_uploads_of_an_automatic_only_posted_row`: sweep row `{"num": 1, "media_urls": [MEDIA+"u/a.jpg"],
    "cover_url": "", "status": "posted", "assist_done_at": None, "tg_message_id": ""}`. Assert the DELETE body is
    `{"prefixes": ["u/a.jpg"]}` and row 1 is PATCHed to `{"media_urls": []}`.
  - `test_cleanup_keeps_a_tiktok_draft_until_handed_off`: a user row `{"num": 2, "media_urls": [MEDIA+"u/a.mp4"],
    "cover_url": "", "status": "posted", "assist_done_at": None, "tg_message_id": "55"}` keeps `u/a.mp4`
    (it isn't in the DELETE prefixes).
  - Update `test_cleanup_deletes_only_own_uploads_of_finished_handed_off_rows`: the sweep has no `assist_done_at`
    param any more, and asserts
    `sweep.url.params["and"] == "(or(assist_done_at.not.is.null,tg_message_id.eq.),or(media_urls.neq.{},cover_url.neq.))"`.
  - Update the second fixture in `test_cleanup_keeps_a_file_an_unfinished_row_still_uses`: add `"tg_message_id": "9"`
    (it means "posted, not handed off yet", which under the new rule needs a Telegram message).
  - Make `cleanup_repo`'s mock route on `"ov." in request.url.params.get("or", "")`. That still works, because the
    users query keeps its `or` param.
- [ ] **Step 2:** `python -m uv run pytest tests/test_supabase_repo.py -q`. Expected: the new and updated tests FAIL.
- [ ] **Step 3: Implement.** In `cleanup_media`, set `select = "num,media_urls,cover_url,status,assist_done_at,tg_message_id"`.
  Replace the `assist_done_at` and `or` params of the sweep with the single `and` param above. Change `_finished` to the
  Interfaces rule and fix its docstring: "Posted, and handed off or never sent by hand".
- [ ] **Step 4:** Run the whole suite: `python -m uv run pytest -q`. Expected: all pass.
- [ ] **Step 5: Web wording.** The note becomes `'The original file was removed after the post went out. Add it again.'`
  in `actions.ts`, `Composer.tsx` and `actions.test.ts`. Also fix the two comments above them that say "by-hand".
  Run `npm test` in `web/`. Expected: 98 pass.
- [ ] **Step 6:** Ruff check and format, then commit: `fix: clean up uploads of posts that went out automatically`.

### Task 3: One owner for "start the workflow" (dispatch_due), and bounded retries

Findings 3 and 4. They go in one migration because both change `dispatch_due`.

**Files:**
- Create: `supabase/migrations/20261106000000_dispatch_single_owner.sql`
- Modify: `supabase/functions/dispatch/index.ts`
- Modify: `web/src/actions.ts:8` (comment only)

**Interfaces:**
- Produces: `public.dispatch_due() returns void`, executable by `service_role`. It only dispatches when a row has
  `status in ('scheduled','partial') and publish_at <= now() and publish_at > now() - interval '3 hours'`.
- The `dispatch` function returns `{dispatched: true}` (HTTP 200) when the RPC succeeded, `{dispatched:false}`
  (502) when it failed, and 401 when nobody is signed in. Response bodies never contain upstream text.

- [ ] **Step 1: Write the migration.** `create or replace function public.dispatch_due()` is the current body
  (copy it from `20261030000000_dispatch_due.sql`) with the extra `publish_at > now() - interval '3 hours'` condition.
  Comment: "matches PP_LATE_GRACE_MINUTES (180): later than that, the publisher marks it missed anyway". Then
  `revoke execute on function public.dispatch_due() from public, anon, authenticated;` and
  `grant execute on function public.dispatch_due() to service_role;`.
- [ ] **Step 2: Apply it** with `apply_migration` (name `dispatch_single_owner`) to `wsclesrylegjsyfxaamr`.
- [ ] **Step 3: Verify (read-only SQL):**
  - `select has_function_privilege('service_role','public.dispatch_due()','execute')` → `true`.
  - `select has_function_privilege('anon','public.dispatch_due()','execute')` → `false`.
  - `select pg_get_functiondef('public.dispatch_due()'::regprocedure) like '%3 hours%'` → `true`.
- [ ] **Step 4: Rewrite `dispatch/index.ts`.** Keep `isSignedInUser` and CORS. Replace the GitHub call with
  `POST ${SUPABASE_URL}/rest/v1/rpc/dispatch_due`, using the headers `apikey` and `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`
  and the body `{}`. A 2xx reply gives `{dispatched: true}`, anything else gives `{dispatched: false}` with 502. Remove the
  `GITHUB_TOKEN`/`GITHUB_REPO` reads and update the header comment. The token now lives only in Vault (`postpilot_github_token`).
- [ ] **Step 5: Deploy** with `deploy_edge_function` (name `dispatch`, `verify_jwt: true`).
- [ ] **Step 6: Verify without publishing.** Make sure no post is due (`select count(*) from posts where status in
  ('scheduled','partial') and publish_at <= now()` → 0). Then:
  - `curl -s -X POST https://wsclesrylegjsyfxaamr.supabase.co/functions/v1/dispatch -H "apikey: <publishable key>"`
    → 401 `sign in required`.
  - `select count(*) from net._http_response` doesn't change after the timer's next tick (nothing due, so no call).
- [ ] **Step 7:** Fix the `publishSoon` comment ("Without the token in Vault, the next scheduled run picks it up")
  and commit: `fix: dispatch through dispatch_due only; stop poking GitHub after the late window`.

### Task 4: Remove the legacy Google Sheet store

Finding 5: about 300 lines and the `gspread` dependency, all unused since Supabase went live.

**Files:**
- Delete: `src/postpilot/sheet.py`, `tests/test_sheet.py`
- Modify: `tests/fakes.py` (gets the parsing it imported from `sheet.py`)
- Modify: `src/postpilot/cli.py` (drop `init-sheet`, `_repository` always returns `SupabaseRepository`, doctor docstring)
- Modify: `src/postpilot/config.py` and `tests/test_config.py`
- Modify: `tests/test_cli.py:33` (command list without `init-sheet`)
- Modify: `pyproject.toml` (remove `gspread`), `uv.lock` (regenerate)
- Modify: `.github/workflows/publish.yml` (gate on `SUPABASE_SERVICE_ROLE_KEY` only, drop `GOOGLE_*` env)
- Modify: `.env.example`, `README.md`, `CLAUDE.md` (Store line)
- Modify: `src/postpilot/models.py:92,182` and `src/postpilot/timeutil.py:8` (docstrings that say "sheet")

**Interfaces:**
- Produces: `tests/fakes.py` defines `posts_from_values(values, required=POST_COLUMNS) -> list[Post]` and
  `accounts_from_values(values) -> dict[str, Account]`, with the same behaviour as today (moved, along with `_cells`).
  `FakeRepository` doesn't change.
- `Config` loses `sheet_id`, `service_account_json` and `service_account_file`. `load_config` requires
  `META_GRAPH_VERSION`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

- [ ] **Step 1: Write the failing config tests.** `BASE` becomes
  `{"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "k", "META_GRAPH_VERSION": "v23.0"}`.
  Replace `test_missing_lists_names_only` with: `load_config({"SUPABASE_SERVICE_ROLE_KEY": "secret"})` raises, the
  message has `"SUPABASE_URL"` and `"META_GRAPH_VERSION"`, and it doesn't contain `"secret"`. Delete
  `test_needs_a_service_account` and `test_supabase_replaces_google_settings`. `test_defaults` stops asserting `sheet_id`.
- [ ] **Step 2:** `python -m uv run pytest tests/test_config.py -q`. Expected: FAIL (the URL isn't required yet).
- [ ] **Step 3: Implement the config change**, then move `_cells`, `posts_from_values` and `accounts_from_values` into
  `tests/fakes.py`. Delete `sheet.py` and `test_sheet.py`, and remove every import and use of them in `cli.py` and the
  `init-sheet` command. Check with `rg -n "sheet|gspread|GOOGLE_" src tests .github pyproject.toml` → only the docstrings
  you are about to fix, and nothing else.
- [ ] **Step 4:** Remove `gspread` from `pyproject.toml`, run `python -m uv lock`, then `python -m uv sync`.
- [ ] **Step 5: Workflow.** `ready` becomes `${{ secrets.SUPABASE_SERVICE_ROLE_KEY != '' && vars.META_GRAPH_VERSION != '' }}`.
  Delete the `GOOGLE_SERVICE_ACCOUNT_JSON` and `GOOGLE_SHEET_ID` env lines.
- [ ] **Step 6: Docs.** README describes the app + Supabase setup and drops the Sheet sections. `.env.example` loses the
  Google block. In CLAUDE.md the Store line becomes "Supabase (`supabase/migrations/`)". Fix the "sheet" docstrings
  (the `row` field becomes "the post's number (`posts.num`)").
- [ ] **Step 7: Verify.** `python -m uv run pytest -q` → all pass (the count drops by `test_sheet.py`'s tests). Ruff check
  and format are clean. `python -m uv run postpilot --help` lists no `init-sheet`. Then commit:
  `chore: remove the legacy Google Sheet store and gspread`.

### Task 5: Supabase security warnings

Finding 6.

**Files:**
- Create: `supabase/migrations/20261106000100_pg_net_schema.sql`

- [ ] **Step 1: Write the migration.** pg_net can't be moved with `alter extension ... set schema`, so the migration is
  `drop extension if exists pg_net; create extension pg_net with schema extensions;`. Comment: "the advisor
  flagged pg_net in public; its functions stay in schema `net`, so `dispatch_due` is unchanged."
- [ ] **Step 2: Apply** with `apply_migration` (name `pg_net_schema`).
- [ ] **Step 3: Verify.**
  - `select extnamespace::regnamespace from pg_extension where extname = 'pg_net'` → `extensions`.
  - `select to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null` → `true`.
  - `get_advisors` (security) has no `extension_in_public` finding.
- [ ] **Step 4: Leaked-password protection (manual, by the user).** Dashboard → Authentication → Providers → Email →
  "Prevent use of leaked passwords". If your plan doesn't offer it, skip it. Sign-ups are off, so the risk is low.
- [ ] **Step 5:** Commit: `chore: move pg_net out of the public schema`.

### Task 6: Ship

- [ ] **Step 1:** Update PROGRESS.md: the timer token lives in Vault only (no `GITHUB_TOKEN` secret), automatic-only
  uploads are cleaned up, the Sheet path is gone, and the go-live checklist loses its Sheet and `GITHUB_TOKEN` steps.
  Commit `docs: progress after audit fixes`.
- [ ] **Step 2:** Push `fix/audit-2026-11-06`, open the PR with a summary of findings 1-6, and wait for CI. Then comment
  `@codex review`.
- [ ] **Step 3:** After merge, the user does Task 1. Then check that the next due post's run shows up as `workflow_dispatch`
  in `gh run list --workflow publish.yml` within about 10 minutes of its time.
