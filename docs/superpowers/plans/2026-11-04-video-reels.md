# Video to FB/IG Reels and X Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One uploaded clip (≤ 90 s, optional cover) posts automatically as a Facebook Page Reel, an Instagram Reel and an X video, with the existing never-twice guarantees.

**Architecture:** Each adapter (`facebook.py`, `instagram.py`, `x.py`) gains a video path that waits for processing inside the run; the runner stays platform-agnostic and learns one thing: a `PlatformError` may carry an `object_id` that must be saved (a Reel accepted but unconfirmed). A new `posts.cover_url` column carries the cover. The web app allows video for these platforms, adds a Cover field, browser-side duration checks, and a "repost only what failed" action.

**Tech Stack:** Python 3 + httpx + pytest (publisher), Vite + React + TS + vitest (web), Supabase (Postgres + Storage).

**Spec:** `docs/superpowers/specs/2026-11-04-video-reels-design.md`

## Global Constraints
- Never publish for real while developing; dry runs only. Tests never call real APIs (`httpx.MockTransport`, `FakeGraph`, `FakeRepository`).
- Idempotency: a filled platform ID means never publish that platform again; write each ID back the moment it exists.
- Harmless steps may retry (`safe=True`); the one step that makes a post public is `safe=False`.
- Runner must not know Graph/X API details; adapters must not know about the store.
- Mirrors stay in step: `web/src/validation.ts` ↔ `src/postpilot/validation.py`.
- Never print/log tokens or raw httpx messages.
- No new dependencies. Schema change = new migration file, RLS stays owner-only.
- Files ≤ 50 MB (Storage limit, unchanged). Clips are ≤ 90 s.
- A cover problem never fails or blocks a post.
- Commands: `.\.venv\Scripts\python.exe -m pytest -q` (uv's trampoline fails in this path), `ruff check . && ruff format .` via the venv; in `web/`: `npm test`, `npm run build`.
- Branch: `feat/video-reels` (exists, holds the spec). Open a PR at the end; `@codex review`.

## Review Focus
1. **Reel accepted but still processing when the budget ends** → FB ID saved, row `failed` with a "check" message, no first comment attempted, never re-sent by Retry. (Task 2 + Task 4 tests.)
2. **Clip whose duration the browser can't read** (e.g. some `.mov`) → not blocked by the composer; the platform's own rejection reports it. (Task 9 test.)
3. **PNG cover** → converted to JPEG on upload even when Instagram isn't selected; a cover on a non-video post is refused. (Task 1 + Task 9 tests.)
4. **Facebook returns a relative `permalink_url` for videos** (`/reel/123`) → stored as an absolute `https://www.facebook.com/...` link. (Task 4 test.)
5. **Cleanup deletes only our own uploads, only for finished rows** → outside links untouched, rows still pending untouched, a failed delete keeps the links. (Task 7 tests.)

---

### Task 1: Schema, model and validation mirrors

**Files:**
- Create: `supabase/migrations/20261104000000_video_cover.sql`
- Modify: `src/postpilot/validation.py`, `web/src/validation.ts`, `web/src/types.ts` (Post), `tests/fakes.py` (FakeRepository columns), the composer's `Draft` type (wherever `validate(d: Draft…)` gets it)
- Test: `tests/test_validation.py`, `web/src/validation.test.ts`

**Interfaces:**
- Produces: column `posts.cover_url text not null default ''`; `Post.get("cover_url")`; web `Post.cover_url: string`; `Draft.coverUrl?: string`, `Draft.videoSeconds?: number | null`.

- [ ] **Step 1: Write the migration** `alter table posts add column cover_url text not null default '';` (no policy changes). Add `"cover_url"` to FakeRepository's Supabase-only columns.
- [ ] **Step 2: Write failing Python tests**
  - `test_video_allowed_to_facebook_instagram_x`: platforms `facebook,instagram,x`, `media_type=video`, one https `.mp4` → `validate()` returns no video-related error.
  - `test_instagram_jpeg_rule_only_for_images`: IG + video `.mp4` → no "JPEG" error; IG + image `.png` → JPEG error (unchanged).
  - `test_cover_needs_video_https_and_jpeg`: `cover_url` with `media_type=image` → error `"A cover is only for videos"`; `cover_url="http://…"` → error containing `https://`; `cover_url` ending `.png` → error `"The cover must be a JPEG"`.
- [ ] **Step 3: Run** `.\.venv\Scripts\python.exe -m pytest tests/test_validation.py -q` → the new tests FAIL.
- [ ] **Step 4: Implement in `validation.py`**: delete the "Video to Facebook/Instagram isn't supported yet" and "Video to X isn't supported yet" errors; Instagram needs `media_type` image **or** video (`"Instagram needs an image or a video"`), JPEG check only when image; add the three cover errors above. Keep "Only one image per post" but reword to `"Only one media file per post for now"`.
- [ ] **Step 5: Mirror in `validation.ts`** with the same messages, plus duration rules when `d.mediaType === 'video' && d.videoSeconds != null`: Facebook Reel 3–90 s, Instagram Reel 3 s–15 min, X ≤ 140 s → error `"<Platform> takes videos of <limit>: this one is <n> s"`. Builder confirms the limits in current Meta/X docs before coding them. `videoSeconds == null` → no duration error.
- [ ] **Step 6: Write the matching vitest cases** (same three as Step 2, plus `videoSeconds: 120` with facebook → FB error and no X error; `videoSeconds: null` → none). Run `npm test` in `web/` → PASS. Run pytest → PASS.
- [ ] **Step 7: Apply the migration** to project `wsclesrylegjsyfxaamr` (Supabase MCP `apply_migration`), confirm the column with `list_tables`. Commit: `feat: allow video to FB/IG/X in validation, cover_url column`.

### Task 2: Runner saves an ID carried by an error

**Files:**
- Modify: `src/postpilot/models.py` (`PlatformError`), `src/postpilot/runner.py` (`_publish_row`)
- Test: `tests/test_runner.py`

**Interfaces:**
- Produces: `PlatformError(kind: str, message: str, object_id: str = "")` — `object_id` set means "the platform holds this object; save it so it's never sent again".

- [ ] **Step 1: Failing tests**
  - `test_error_with_object_id_saves_the_id_and_fails_for_a_check`: a facebook publisher raising `PlatformError("unknown", "Facebook accepted the Reel but was still processing; check it's on your Page", object_id="V1")` → row `fb_post_id == "V1"`, `status == "failed"`, `last_error` contains `facebook: Facebook accepted`.
  - `test_no_first_comment_on_a_platform_that_errored_this_run`: same row with `first_comment="hi"` and a facebook commenter that records calls → commenter never called; `fb_comment_id` stays empty; `last_error` contains `Comment on Facebook may not have been added`.
  - `test_retry_after_object_id_error_never_resends_that_platform`: run again after setting status back to `scheduled` → facebook publisher not called.
- [ ] **Step 2: Run** `pytest tests/test_runner.py -q` → FAIL.
- [ ] **Step 3: Implement**: in the publisher `except PlatformError as e` branch, `if e.object_id: save({ID_COLUMN[platform]: e.object_id})` before appending the error. In the comment loop, skip platforms in this run's `errors`; for those with `post.get("first_comment")`, add `_comment_note(platform, "unknown")` to the final message (no sentinel stored, so a later repost can still comment).
- [ ] **Step 4: Run** pytest → PASS. Commit: `feat(runner): save the ID an unclear publish error carries`.

### Task 3: GraphClient can upload by URL and send a file

**Files:**
- Modify: `src/postpilot/graph.py`
- Test: `tests/test_graph.py`

**Interfaces:**
- Produces: `GraphClient.rupload(video_id: str, file_url: str) -> dict` — `POST https://rupload.facebook.com/video-upload/{version}/{video_id}` with headers `Authorization: OAuth <token>` and `file_url: <file_url>`; safe (an upload to an unfinished Reel is harmless), same error classification/retry as `_request`.
- Produces: `GraphClient.post(path, *, safe, files: dict | None = None, **data)` — `files` passed through to httpx as multipart.

- [ ] **Step 1: Failing tests** with `httpx.MockTransport`: `test_rupload_sends_file_url_header_to_rupload_host` (asserts host `rupload.facebook.com`, path `/video-upload/v23.0/V1`, header `file_url`, no token in the URL); `test_rupload_500_is_retried_then_transient`; `test_post_with_files_sends_multipart`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (reuse `_request`'s loop; factor the URL/headers in, don't duplicate the retry logic). **Step 4: Run** → PASS. Commit: `feat(graph): rupload by URL and multipart posts`.

### Task 4: Facebook Reel publishing

**Files:**
- Modify: `src/postpilot/facebook.py`, `tests/test_adapters.py` (`FakeGraph` gains `rupload`)
- Test: `tests/test_adapters.py`

**Interfaces:**
- Consumes: Task 2 `PlatformError(..., object_id=)`, Task 3 `rupload`, `post(files=)`.
- Produces: `facebook.publish(graph, account, post, sleep=time.sleep, checks=60, download=None) -> PublishResult` — video path when `post.get("media_type") == "video"`. `download: Callable[[str], tuple[bytes, str]] | None` fetches the cover (CLI passes `lambda u: rest.download(http, u, "Facebook")`).

Flow: `POST {page}/video_reels upload_phase=start` (safe) → `rupload(video_id, media_urls[0])` → `POST {page}/video_reels upload_phase=finish video_id=… video_state=PUBLISHED description=<text_for("facebook")>` (**safe=False**) → poll `GET {video_id} fields=status` every 5 s up to `checks` (5 min) until published → permalink via `fetch_permalink(graph, video_id, "permalink_url")`, made absolute with `https://www.facebook.com` when it starts with `/` → if `cover_url` and `download`: best-effort `POST {video_id}/thumbnails` with `files={"source": …}`, `is_preferred=true`, any exception swallowed. Builder confirms the status field names (`video_status`, `processing_phase`, `publishing_phase`) in Meta's Reels docs, and that the video ID is the object first comments (`{id}/comments`) and stats use; if stats need different fields for a video, branch `facebook.stats` on it (a stats problem already never fails a run).

- [ ] **Step 1: Failing tests**
  - `test_fb_reel_start_upload_finish_wait_permalink`: asserts call order, finish is `safe=False` with `video_state=PUBLISHED` and the FB caption, result id `V1`, permalink `https://www.facebook.com/reel/V1` from a relative `/reel/V1`.
  - `test_fb_reel_processing_error_is_permanent_without_id`: status reports an error → `PlatformError` kind `permanent`, `object_id == ""`.
  - `test_fb_reel_still_processing_is_unknown_with_id`: status never published, `checks=3` → kind `unknown`, `object_id == "V1"`, message contains `check it's on your Page`.
  - `test_fb_reel_finish_unclear_is_unknown`: finish raises `unknown` → propagates, no status polling.
  - `test_fb_reel_cover_failure_is_ignored`: thumbnails call raises → result still returned.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** in `facebook.py` (photo/text paths unchanged). **Step 4: Run** → PASS. Commit: `feat(facebook): publish Page Reels`.

### Task 5: Instagram Reel publishing

**Files:**
- Modify: `src/postpilot/instagram.py`
- Test: `tests/test_adapters.py`

**Interfaces:**
- Produces: `instagram.publish(graph, account, post, sleep=time.sleep, checks=12)` — video path: container with `media_type=REELS`, `video_url`, `share_to_feed=true`, `caption`, and `cover_url` when set; the CLI passes `checks=60` (5 min) for video. Everything else (poll `status_code`, `ERROR`/`EXPIRED` permanent, not finished = transient, `media_publish` once) as the image path.

- [ ] **Step 1: Failing tests**: `test_ig_reel_container_fields` (asserts the exact container fields with and without cover); `test_ig_reel_error_message_mentions_the_video` (ERROR → permanent, message `"Instagram couldn't use the video: …"`, not the JPEG hint); existing still-processing test passes for video.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (one container-fields branch; error text per media type). **Step 4: Run** → PASS. Commit: `feat(instagram): publish Reels`.

### Task 6: X video publishing

**Files:**
- Modify: `src/postpilot/x.py`
- Test: `tests/test_x_tiktok.py`

**Interfaces:**
- Produces: `x.publish(http, token, post, sleep=time.sleep, checks=60) -> PublishResult` — video path: download → initialize (`total_bytes`, `media_type`, `media_category`) → append chunks (reuse `tiktok._chunks`-style splitting; move it to `rest.py` as `chunks(size: int, chunk: int) -> list[tuple[int, int]]` if shared) → finalize → poll status until `processing_info.state == "succeeded"` (honour `check_after_secs`, capped at 10 s) → create post once (`safe=False`). All upload steps `safe=True`; processing `failed` → permanent with X's message; budget out → transient. Builder confirms the v2 endpoint paths and `tweet_video` vs `amplify_video` in docs.x.com (spec: docs disagree) and records the choice in a one-line comment.

- [ ] **Step 1: Failing tests** (MockTransport handler like the TikTok ones): `test_x_video_chunked_upload_then_post` (initialize→append×n→finalize→status→tweets, tweet has the media id, only the tweets call is unsafe); `test_x_video_processing_failed_is_permanent_and_never_posts`; `test_x_video_still_processing_is_transient_and_never_posts`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**. **Step 4: Run** → PASS (image tests unchanged). Commit: `feat(x): publish video`.

### Task 7: CLI wiring, longer workflow, storage cleanup

**Files:**
- Modify: `src/postpilot/cli.py`, `src/postpilot/supabase_repo.py`, `.github/workflows/publish.yml`
- Test: `tests/test_supabase_repo.py`, `tests/test_cli.py`

**Interfaces:**
- Produces: `SupabaseRepository.cleanup_media(nums: list[int]) -> None` — for those rows that are `posted` **and** have `assist_done_at` set: delete their `media_urls` + `cover_url` objects that live under this project's `/storage/v1/object/public/media/` prefix (`DELETE /storage/v1/object/media` with `{"prefixes": [...]}`), then on success PATCH `media_urls=[]`, `cover_url=''`. Any failure: leave the row as is and return (never raise into the run).

- [ ] **Step 1: Failing repo tests** (mocked routes): `test_cleanup_deletes_only_own_uploads_of_finished_handed_off_rows` (outside URL kept; row without `assist_done_at` untouched); `test_cleanup_failed_delete_keeps_links`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `cleanup_media`. In `cli.publish`, after `run()` and only when not a dry run: `if hasattr(repo, "cleanup_media") and report.posted: repo.cleanup_media(report.posted)`. Wire `facebook.publish(..., download=…)`, and pass `checks=60` for video to Instagram. Raise `timeout-minutes` in `publish.yml` from 10 to 30.
- [ ] **Step 4: Failing→passing CLI test**: `test_dry_run_never_cleans_up` (dry run with a posted row → `cleanup_media` not called).
- [ ] **Step 5: Run** full pytest + `ruff check .` → PASS. Dry run against live data: `.\.venv\Scripts\python.exe -m postpilot.cli publish --dry-run` (env from `.env`) reads cleanly. Commit: `feat: wire video publishing, cleanup handed-off media`.

### Task 8: Telegram sends the cover

**Files:**
- Modify: `src/postpilot/telegram.py`
- Test: `tests/test_telegram.py`

- [ ] **Step 1: Failing test** `test_assist_sends_cover_after_the_video`: video post with `cover_url` → a `sendPhoto` with the cover and caption `"Cover"` after the video message; a `sendPhoto` failure is ignored (message still returns the first id). No cover → no extra call.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**. **Step 4: Run** → PASS. Commit: `feat(telegram): send the cover with by-hand videos`.

### Task 9: Composer cover + duration, Handoff cover

**Files:**
- Modify: `web/src/screens/Composer.tsx`, `web/src/screens/Handoff.tsx`, `web/src/media.ts`, `web/src/actions.ts` (`startPostAgain` copies `cover_url`), `web/src/prefs.ts` (draft shape)
- Test: `web/src/media.test.ts` (create), `web/src/validation.test.ts`

**Interfaces:**
- Consumes: Task 1 `Draft.coverUrl`, `Draft.videoSeconds`.
- Produces: `videoSeconds(file: File): Promise<number | null>` in `media.ts` (reads `<video>` `loadedmetadata`, `null` on error or after 5 s).

- [ ] **Step 1: Failing test** `media.test.ts`: `videoSeconds` resolves `null` when the element errors (stub `document.createElement('video')`).
- [ ] **Step 2: Implement** `videoSeconds`. Composer: on video upload store its seconds in state and pass it into the Draft; a **Cover** settings row (shown only when the media is a video, same row/sheet pattern as the others) that uploads an image through the existing `upload` path with `toJpeg` **always** applied, sets `coverUrl`, and can be removed. Save writes `cover_url`. Post again copies it unless media was removed. Handoff: show the cover with a download/open link when set; `done()` deletes the cover with the media under the same rules and clears `cover_url`.
- [ ] **Step 3: Run** `npm test` and `npm run build` → PASS. Check in the dev server (`npm run dev`, Playwright at phone width): Cover row appears only for video, PNG cover uploads as `.jpg`. Commit: `feat(web): cover image and video length checks`.

### Task 10: Repost only what failed

**Files:**
- Modify: `web/src/postView.ts`, `web/src/actions.ts`, `web/src/screens/PostDetail.tsx`
- Test: `web/src/postView.test.ts`, `web/src/actions.test.ts`

**Interfaces:**
- Produces: `failedPlatforms(post: Post): Platform[]` — automatic platforms of a `failed` post named as `"<platform>: "` in `last_error` (not `"<platform> comment: "`). `repostFailed(post: Post): Promise<string | null>` — clears ID, permalink and comment columns of `failedPlatforms(post)` only, then requeues exactly like `retryNow` (same `.in('status', ['failed','missed'])` guard; zero rows updated → error "This post changed; reload").

- [ ] **Step 1: Failing tests**: `failedPlatforms` on `"facebook: Facebook accepted the Reel…; facebook comment: x"` with platforms `facebook,instagram,x` → `['facebook']`; on a posted row → `[]`. `repostFailed` sends an update that clears `fb_post_id`, `fb_permalink`, `fb_comment_id` and leaves `ig_media_id`/`x_post_id` out of the payload.
- [ ] **Step 2: Implement**. PostDetail: when `!canRetry(post) && failedPlatforms(post).length`, show "Checked: not on <names>. Repost there only" (confirm step before acting, same pattern as other destructive buttons there).
- [ ] **Step 3: Run** `npm test`, `npm run build` → PASS. Commit: `feat(web): repost only the platforms that failed`.

### Task 11: Docs and PR

- [ ] Update `PROGRESS.md` (video to FB/IG Reels + X done; X untested live until connected; FB Reel cover best-effort; one real test post when the user says so) and `tasks/plan.md` item 8. Full checks: pytest, ruff, `npm test`, `npm run build`. Push, open PR "Video to FB/IG Reels and X", comment `@codex review`, wait for CI.
