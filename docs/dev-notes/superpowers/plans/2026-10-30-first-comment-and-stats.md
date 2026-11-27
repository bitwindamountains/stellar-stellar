# First Comment + Post Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An optional first comment that the publisher posts under Facebook Page / Instagram posts (and that by-hand platforms get as a copy button), plus per-post stats and top 5 comments in the Posted tab.

**Architecture:** New `posts` columns hold the comment text, one comment ID per platform (idempotency, like post IDs) and a `stats` JSON blob. The runner gets a `commenters` mapping beside `publishers` (Graph calls stay in `facebook.py`/`instagram.py`). A new store-agnostic `stats.py` refreshes stats after each real run through injected fetchers; the web app only reads what the publisher stored.

**Tech Stack:** Python 3 + httpx + typer (publisher, pytest), Supabase Postgres (migration), Vite + React + TS (web, vitest), Deno Edge Function (`connect`).

**Spec:** `docs/superpowers/specs/2026-10-30-first-comment-and-stats-design.md` (read it with this plan).

## Global Constraints
- Idempotency: a filled ID means never repeat that call. Comment IDs (`fb_comment_id`, `ig_comment_id`) are written back immediately after each comment succeeds.
- No call repeated within a run. Retryable comment failures → `partial`; a permanent/`unknown`/out-of-attempts comment failure on a live post → **`posted`** with `last_error` like `Comment not added on Instagram: add it by hand`. No Retry for comments.
- Runner knows no Graph API details; adapters know nothing about the store.
- Mirrors: `web/src/validation.ts` ↔ `src/postpilot/validation.py` (same rules, same wording).
- Stats failures never change a post's status or the run's exit code; dry runs fetch and write no stats.
- Stats window: posts with `posted_at` in the last **7 days** and a real FB/IG post ID.
- Never print/log tokens; never surface raw httpx messages.
- Tests never call real APIs (`httpx.MockTransport`, `FakeRepository`, mocked Supabase routes). No new dependencies.
- Schema change: new migration file, RLS stays owner-only; apply to `wsclesrylegjsyfxaamr` only.
- Commands: `python -m uv run pytest -q`, `python -m uv run ruff check . && python -m uv run ruff format .`; in `web/`: `npm test`, `npm run build`.
- Google Sheet backend: not supported; it has no `first_comment` column so `Post.get("first_comment")` is `""` and nothing happens there. No sheet changes.

## Review Focus
1. Comment-only work left on a `partial` post that is now past the late-grace window: selector marks it `exhausted` → must end `posted` with a note, not `failed` (Task 3).
2. A run that dies after posting but before commenting leaves the row stale in `posting` with every post ID filled: must end `posted` with a "check the comment" note, not a `failed` with an empty platform list (Task 3).
3. A Meta login without the new permissions: comment fails with an auth/permission error → `posted` with `Reconnect Meta in Accounts to allow comments`; stats skip that post quietly (Tasks 3, 6).
4. Meta rejects a retired/renamed insight metric: only that number is missing; likes/comments/top comments still saved (Task 5).
5. Multi-account group edited after one row went live: the First comment field is locked for the whole group, and Save never sends `first_comment` changes for rows with a filled FB/IG ID (Task 8).

---

### Task 1: Schema + model plumbing

**Files:**
- Create: `supabase/migrations/20261031000000_first_comment_stats.sql`
- Modify: `src/postpilot/models.py`, `src/postpilot/supabase_repo.py` (`_to_cells`)
- Test: `tests/test_models.py`, `tests/test_supabase_repo.py`

**Interfaces:**
- Produces: columns `posts.first_comment text not null default ''`, `posts.fb_comment_id text not null default ''`, `posts.ig_comment_id text not null default ''`, `posts.stats jsonb not null default '{}'::jsonb check (jsonb_typeof(stats) = 'object')`.
- Produces in `models.py`: `COMMENT_COLUMN = {FACEBOOK: "fb_comment_id", INSTAGRAM: "ig_comment_id"}`; `Post.comment_pending(platform: str) -> bool` (True when `first_comment` is set, `platform in COMMENT_COLUMN`, `self.done(platform)`, and its comment column is empty); `Post.stats -> dict` property (parses `cells["stats"]` JSON like `variants`; bad JSON → `{}`).
- Produces in `supabase_repo._to_cells`: `cells["stats"] = json.dumps(row.get("stats") or {})`.

- [ ] **Step 1: Write failing tests**: `test_comment_pending` (cases: no comment text → False; FB not done → False; FB done, comment ID empty → True; comment ID filled → False; `x` → False). `test_stats_parses_json` (`'{"facebook": {"likes": 3}}'` → dict; `"nope"` → `{}`). In `test_supabase_repo.py`, extend the load test: a row with `"stats": {"instagram": {"likes": 2}}` gives `post.stats == {"instagram": {"likes": 2}}`.
- [ ] **Step 2: Run** `python -m uv run pytest -q tests/test_models.py tests/test_supabase_repo.py` → new tests FAIL.
- [ ] **Step 3: Implement** the migration (one `alter table public.posts add column ...` per column, header comment explaining comment IDs = idempotency) and the model/repo pieces above.
- [ ] **Step 4: Run** the full suite → PASS.
- [ ] **Step 5: Apply the migration** to project `wsclesrylegjsyfxaamr` (Supabase MCP `apply_migration`, or the user runs it in the SQL editor if that's blocked). Verify: `select column_name from information_schema.columns where table_name='posts' and column_name in ('first_comment','fb_comment_id','ig_comment_id','stats')` returns 4 rows.
- [ ] **Step 6: Commit** `publisher: first_comment, comment IDs and stats columns`.

### Task 2: Comment adapters + validation mirrors

**Files:**
- Modify: `src/postpilot/facebook.py`, `src/postpilot/instagram.py`, `src/postpilot/validation.py`, `web/src/validation.ts`
- Test: `tests/test_adapters.py`, `tests/test_validation.py`, `web/src/validation.test.ts`

**Interfaces:**
- Produces: `facebook.comment(graph, post_id: str, text: str) -> str` and `instagram.comment(graph, media_id: str, text: str) -> str`: `graph.post(f"{id}/comments", safe=False, message=text)["id"]` (not safe: a timeout must classify as `unknown`, never retried).
- Produces validation constants (both mirrors, same names in each language's case): `IG_COMMENT_MAX = 300`, `IG_COMMENT_HASHTAGS_MAX = 4`, `IG_COMMENT_URLS_MAX = 1`. **Before coding, confirm these three against Meta's current "IG Media Comments" reference** (it lists: 300 characters or fewer, at most 4 hashtags, at most 1 URL, not all capital letters); if Meta's numbers differ, use Meta's and note it in the commit.
- Produces web `Draft.firstComment: string`.
- Rules (only when `first_comment` is non-empty), messages verbatim in both mirrors:
  - Instagram selected: length > 300 → `First comment: Instagram allows at most 300 characters`; hashtags > 4 → `First comment: Instagram allows at most 4 hashtags`; URLs (`https?://` count) > 1 → `First comment: Instagram allows at most 1 link`; letters present and all uppercase → `First comment: Instagram rejects all-caps comments`.
  - Any by-hand platform selected (fb_profile, youtube, shopee, by-hand tiktok/x): Telegram length (UTF-16 units, Python `_telegram_len`) + `TELEGRAM_OVERHEAD` > 4096 → `First comment too long for the phone handoff`.

- [ ] **Step 1: Write failing tests**: adapter tests with MockTransport asserting the POST path `.../POSTID/comments`, form field `message`, returned id; a timeout on that POST raises `PlatformError` with kind `unknown`. Validation tests per rule above in both `tests/test_validation.py` and `web/src/validation.test.ts` (same cases, same messages), plus "empty first comment adds no errors".
- [ ] **Step 2: Run** `python -m uv run pytest -q tests/test_adapters.py tests/test_validation.py` and `cd web && npm test` → FAIL.
- [ ] **Step 3: Implement** the adapters and both validation mirrors. `web/src/fields.ts` needs no change (unmatched messages fall to the `caption` section, where the field lives).
- [ ] **Step 4: Run** both suites → PASS.
- [ ] **Step 5: Commit** `first comment: Graph comment calls and validation (Python + web mirror)`.

### Task 3: Runner posts comments, with the status rules

**Files:**
- Modify: `src/postpilot/runner.py`, `src/postpilot/cli.py`
- Test: `tests/test_runner.py`, `tests/test_cli.py`

**Interfaces:**
- Consumes: `COMMENT_COLUMN`, `Post.comment_pending` (Task 1); `facebook.comment`, `instagram.comment` (Task 2).
- Produces: `run(repo, publishers, assist, cfg, now, dry_run=False, commenters: dict[str, Commenter] | None = None) -> Report` where `Commenter = Callable[[Post, Account, str], str]` (post, account, the platform's post ID → comment ID). In dry run, commenters become `lambda post, account, object_id: "dry-run"`.
- In `cli.publish`: `commenters = {"facebook": meta_comment(facebook), "instagram": meta_comment(instagram)}`, built like `meta()` (same GraphClient/token), calling `module.comment(graph, object_id, post.get("first_comment"))`.

Behaviour in `_publish_row` (after the publish loop, before the assist block):
- For each API platform of the post with `post.comment_pending(p)` and a commenter: call it once with `post.get(ID_COLUMN[p])`; on success `save({COMMENT_COLUMN[p]: id})` immediately and add `"{p} comment"` to the report line.
- Comment failures go in their own list, not `errors`. Final status:
  - any post/Telegram error → today's rules (comment failures appended to the message; a retryable comment failure alone never makes it `failed`).
  - else, a retryable comment failure and `attempts < max_attempts` → `partial`.
  - else → `posted`, `posted_at` = stamp, `last_error` = the comment notes joined by `"; "` (empty when none). Note wording: `Comment not added on Facebook: add it by hand`; for auth-kind errors `Comment not added on Instagram: reconnect Meta in Accounts to allow comments`; for `unknown`: `Comment on Instagram may not have been added: check, and add it by hand if missing`.
- In `run()`'s close-out loop: an `exhausted` or `stale` post where every platform is `done()` (only comments left) ends `posted` (`posted_at` = stamp) with the note for each pending comment (exhausted: "add it by hand"; stale: the "may not have been added: check" wording), and is counted in `report.posted`, not `report.failed`.

- [ ] **Step 1: Write failing tests** in `tests/test_runner.py` (FakeRepository, stub publishers/commenters):
  - `test_comment_posted_after_publish`: FB publishes "P1", commenter returns "C1" → writes include `fb_comment_id: "C1"` after `fb_post_id`, status `posted`.
  - `test_no_comment_without_text`: commenter never called.
  - `test_partial_retries_only_comment`: row `partial`, `fb_post_id` filled, `fb_comment_id` empty, attempts 1 → publisher not called, commenter called once, `posted`.
  - `test_retryable_comment_failure_is_partial`: commenter raises `PlatformError("transient", ...)`, attempts 1 of 3 → `partial`; same at attempts 3 → `posted` with `Comment not added on Facebook: add it by hand`.
  - `test_permanent_and_unknown_comment_failure_end_posted`: permanent → posted + "add it by hand"; auth → "reconnect Meta in Accounts"; unknown → "may not have been added: check".
  - `test_comment_failure_does_not_stop_other_platform`: FB comment fails permanently, IG post + comment succeed → both IDs saved, `posted` with the FB note.
  - `test_exhausted_comment_only_ends_posted` and `test_stale_comment_only_ends_posted` (Review Focus 1, 2).
  - `test_dry_run_comments_nothing_written`.
  - In `tests/test_cli.py`: the publish command passes `commenters` with `facebook` and `instagram` keys (assert via a monkeypatched `run`).
- [ ] **Step 2: Run** `python -m uv run pytest -q tests/test_runner.py tests/test_cli.py` → FAIL.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run** full suite + ruff → PASS.
- [ ] **Step 5: Commit** `runner: post the first comment once, after the post; live posts end posted with a note`.

### Task 4: Telegram handoff gets the comment

**Files:**
- Modify: `src/postpilot/telegram.py`
- Test: `tests/test_telegram.py`

**Interfaces:**
- `send_assist` signature unchanged. When `post.get("first_comment")` is set, after the caption messages it sends one more `sendMessage` (HTML): `<b>First comment</b>\n<pre>{escape(comment)}</pre>`.

- [ ] **Step 1: Write failing test** `test_assist_sends_first_comment` (MockTransport records calls: last call is `sendMessage` with that text, HTML-escaped `<` in the comment) and `test_assist_without_comment_unchanged` (call count as before).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `telegram: first comment as its own copy block`.

### Task 5: Stats adapters

**Files:**
- Modify: `src/postpilot/facebook.py`, `src/postpilot/instagram.py`
- Test: `tests/test_adapters.py`

**Interfaces:**
- Produces: `facebook.stats(graph, post_id: str) -> dict` and `instagram.stats(graph, media_id: str) -> dict`, each returning only the keys it could read from: `views`, `reach`, `likes`, `comments`, `shares` (FB only) as ints, and `top_comments: list[{"author": str, "text": str, "likes": int, "at": str}]` (unsorted, up to 50 fetched, raw from Graph, normalized to those keys).
- Graph calls (**confirm names against Meta's current docs before coding**; drop any metric Meta has retired, and note it in the commit):
  - IG: `GET {media_id}?fields=like_count,comments_count`; `GET {media_id}/insights?metric=reach` and separately `metric=views` (one call per metric, so a retired metric only loses itself); `GET {media_id}/comments?fields=text,username,like_count,timestamp&limit=50`.
  - FB: `GET {post_id}?fields=reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares`; insights one call per metric for reach and views (current FB post metric names per Meta docs); `GET {post_id}/comments?fields=from{name},message,like_count,created_time&filter=toplevel&limit=50`.
- A `PlatformError` from an insights call → that key absent. A `PlatformError` from the fields or comments call propagates (the orchestrator skips that platform).

- [ ] **Step 1: Write failing tests**: full happy path for each (MockTransport by path/params → expected dict); `test_ig_stats_retired_metric_only_loses_itself` (views call returns Graph error 100 → no `views`, everything else present) (Review Focus 4); FB post without `shares` field → no `shares` key.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `adapters: FB/IG post stats and comments`.

### Task 6: Stats refresh after each run

**Files:**
- Create: `src/postpilot/stats.py`
- Modify: `src/postpilot/supabase_repo.py`, `src/postpilot/cli.py`
- Test: `tests/test_stats.py` (new), `tests/test_supabase_repo.py`, `tests/test_cli.py`

**Interfaces:**
- Consumes: `Post.stats` (Task 1); `facebook.stats` / `instagram.stats` (Task 5).
- Produces in `supabase_repo.py`: `recent_posted(since: datetime) -> list[Post]` (GET posts `status=eq.posted`, `posted_at=gte.{since}`, `order=posted_at.desc`, cells via `_to_cells` with the loaded `self.accounts`; call after `load()`), and `save_stats(num: int, stats: dict) -> None` (PATCH `posts?num=eq.{num}` with `{"stats": stats}`).
- Produces in `stats.py`: `refresh(repo, fetchers: dict[str, Fetcher], now: datetime, days: int = 7, limit: int = 20) -> list[str]` (report lines), `Fetcher = Callable[[Post, Account, str], dict]`; and `top(comments: list[dict], n: int = 5) -> list[dict]` (sort by `likes` desc, then `at` desc).
- `refresh`: for up to `limit` recent posts, for each platform in `fetchers` whose ID is filled and not `SENT_BY_HAND`: fetch, set `top_comments = top(...)`, add `as_of = now.isoformat(timespec="seconds")`. On `PlatformError` for one platform keep the post's previous stats for it and add a line `row N: stats skipped on instagram ({kind})` (kind only, never the message). Save once per post only if something changed. Never raises `PlatformError`; a `StoreError` propagates to the caller.
- `cli.publish`: after `record_run`, when `not dry_run and hasattr(repo, "recent_posted")`, call `stats.refresh(...)` with fetchers built like `meta()`; catch `StoreError` and echo `Stats skipped: ...`; the result never changes the exit code. A missing Meta token for an account (`token()` raising) is treated as a skipped platform.

- [ ] **Step 1: Write failing tests**: `test_top_sorts_by_likes_then_newest`; `test_refresh_saves_both_platforms_with_as_of`; `test_refresh_keeps_old_stats_when_one_platform_fails` (Review Focus 3); `test_refresh_skips_by_hand_and_empty_ids`; `test_refresh_respects_limit`; repo tests for the two new methods' URLs/params; CLI test that a stats `StoreError` leaves exit code 0 and that `--dry-run` never calls `refresh`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** full suite + ruff → PASS.
- [ ] **Step 5: Commit** `stats: refresh FB/IG stats for a week after posting`.

### Task 7: Meta permissions in Connect

**Files:**
- Modify: `supabase/functions/connect/index.ts` (the Meta `scope` string, line ~72)

- [ ] **Step 1:** Append `pages_manage_engagement,instagram_manage_comments,instagram_manage_insights,read_insights` to the Meta scope.
- [ ] **Step 2:** Deploy `connect` (Supabase MCP `deploy_edge_function` with JWT verification **off**, as today, or the user runs `npx supabase functions deploy connect --no-verify-jwt`). Verify the function version went up.
- [ ] **Step 3: Commit** `connect: ask Meta for comment and insights permissions`.
- The user then reconnects Meta once from Accounts (listed in the PR body).

### Task 8: Composer field

**Files:**
- Modify: `web/src/types.ts`, `web/src/screens/Composer.tsx`, `web/src/prefs.ts`, `web/src/PostPreview.tsx`
- Test: `web/src/validation.test.ts` (draft wiring), plus a pure helper test if one is added

**Interfaces:**
- `types.ts` `Post` gains `first_comment: string`, `fb_comment_id: string`, `ig_comment_id: string`, `stats: PostStats` where `PostStats = Partial<Record<'facebook' | 'instagram', PlatformStats>>` and `PlatformStats = { as_of: string; views?: number; reach?: number; likes?: number; comments?: number; shares?: number; top_comments?: { author: string; text: string; likes: number; at: string }[] }`.
- Composer: `firstComment` state (restored from the saved draft; `prefs.ts` draft gains `firstComment?: string`), a "First comment (optional)" textarea in the caption section with the hint `Posted as a comment on Facebook and Instagram; copy it on your phone for the others. Instagram links aren't clickable.`; included in `shared` as `first_comment` and in `validate(...)` drafts; copied by Post again.
- Lock: `const commentLocked = rows.some((r) => r.fb_post_id || r.ig_media_id)`. When locked the textarea is `readOnly` with the note `Already live: add or change the comment in Facebook/Instagram.`, and `first_comment` is left out of `shared` (Review Focus 5).
- Preview shows the comment under the post for FB/IG previews (muted, labelled "First comment").

- [ ] **Step 1: Write failing test** (vitest): `validate` with `firstComment` too long for Instagram returns the Task 2 message (proves the Draft wiring).
- [ ] **Step 2: Run** `cd web && npm test` → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test && npm run build` → PASS.
- [ ] **Step 5: Visual check**: `npm run dev`, screenshot the Composer at desktop and phone width (new post, and an edited post that is already live), per the project's visual-check habit.
- [ ] **Step 6: Commit** `web: First comment field, locked once the post is live`.

### Task 9: Handoff copy button

**Files:**
- Modify: `web/src/screens/Handoff.tsx`

- [ ] **Step 1:** Under each by-hand platform's caption, when `post.first_comment` is set, render `copyButton(`${p}-comment`, 'Copy comment', post.first_comment)` after the caption button.
- [ ] **Step 2: Run** `npm test && npm run build` → PASS; screenshot the Handoff page at phone width with a comment.
- [ ] **Step 3: Commit** `web: Copy comment on the phone handoff`.

### Task 10: Stats and notes in the Posted tab

**Files:**
- Modify: `web/src/postView.ts`, `web/src/screens/Queue.tsx`, `web/src/styles.css` (only if needed)
- Test: `web/src/postView.test.ts`

**Interfaces:**
- Produces in `postView.ts`: `statsLine(s: PlatformStats): string` — `views` (else `reach` labelled "reach"), likes, comments, shares, joined with ` · `, numbers compacted (`1200` → `1.2k`), missing values left out, `''` when nothing; `ago(iso: string, now = new Date()): string` (`just now`, `5 min ago`, `3 h ago`, `2 d ago`).
- Queue: in each row of the **Posted** tab (`filter === 'posted'`), per row with stats, a line `Facebook · 1.2k views · 48 likes · 6 comments · 2 shares` (one per platform) and `as of 3 h ago`; a `<details>` "Top comments" listing up to 5 (author, text, ♥ likes) when any exist. Any `posted` row with a non-empty `last_error` shows it as a muted note (this is where "Comment not added…" appears). Nothing renders for posts without stats.

- [ ] **Step 1: Write failing tests**: `statsLine({as_of: 'x', views: 1200, likes: 48, comments: 6, shares: 2}) === '1.2k views · 48 likes · 6 comments · 2 shares'`; reach fallback `'310 reach · 4 likes'`; empty → `''`; `ago` cases above with a fixed `now`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test && npm run build` → PASS.
- [ ] **Step 5: Visual check**: screenshot the Posted tab desktop + phone with a seeded post that has stats and a comment note (mocked data in dev is fine; no real posts).
- [ ] **Step 6: Commit** `web: post stats, top comments and comment notes in Posted`.

### Task 11: Ship

- [ ] Update `PROGRESS.md` (first comment + stats done; reconnect Meta once; Meta metric names verified on date).
- [ ] Full checks: `python -m uv run pytest -q`, ruff, `cd web && npm test && npm run build`.
- [ ] Push branch `feat/first-comment-stats`, open the PR (body: what changed, migration applied, `connect` deployed, **"Reconnect Meta in Accounts"** step for the user, not tested against real Meta), comment `@codex review`, wait for CI.
- [ ] After merge, the user redeploys the web app (`npm run build && npx wrangler deploy` in `web/`). No real post is made while developing.
