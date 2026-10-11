# PostPilot personal edition: production plan

Source: `docs/ideas/postpilot.md` (scope) + `04_PostPilot_Blueprint.md` (detail).
Where they differ, the idea doc wins.

## Design decisions (vs blueprint)
- **Flat package** `src/postpilot/*.py`; ~12 modules don't need sub-packages.
- **No pydantic, tenacity, respx, time-machine.** Config is a small env reader; retries are a loop;
  HTTP tests use `httpx.MockTransport`; time is passed in as `now`.
- **No approvals column.** `status = scheduled` is the approval.
- **No Log tab.** Each row already holds status, IDs, permalinks and `last_error`; GitHub Actions keeps run logs.
- **No `id` column.** Rows are referred to by sheet row number.
- **Stale `posting` rows become `failed`, never retried.** A crash between "publish" and "write ID" can't be
  told apart from "not published", so the safe default is a human check. Platforms with IDs stay skipped.
- **Assisted platforms** (`fb_profile`, `tiktok`, `youtube`): one Telegram message per row with media + caption.
  `tg_message_id` filled means "already sent".
- **Video** allowed only on rows whose API platforms are none (Telegram-only) until Phase 10.

## Sheet

**Posts:** `account, platforms, publish_at, caption, media_type, media_urls, link, status, attempts,
claimed_at, fb_post_id, fb_permalink, ig_media_id, ig_permalink, tg_message_id, last_error, posted_at`

**Accounts:** `account, fb_page_id, ig_user_id, token_env, timezone`

Statuses: `draft, scheduled, posting, posted, partial, failed, missed`.

## Tasks

Each task: failing test, code, full suite + ruff green, one commit.

### Phase 0: Setup
- [x] 0.1 uv project, Typer CLI skeleton, ruff, pytest
- [x] 0.2 `config.py`: env reader, missing-var error lists names (never values); `.env.example`
- [x] 0.3 `CLAUDE.md`, README stub

### Phase 1: Core model
- [x] 1.1 `models.py`: `Account`, `Post` (from header + row values), platform constants, `done(platform)`
- [x] 1.2 `timeutil.py`: parse `publish_at` in account tz to UTC
- [x] 1.3 `validation.py`: rule list from blueprint 10.1 adjusted for assisted platforms

### Phase 2: Sheet layer
- [x] 2.1 `sheet.py`: header mapping, row parsing, cell-update building (pure, tested)
- [x] 2.2 `SheetRepository` (gspread: load, batch write) + `FakeRepository` for tests
- [x] 2.3 `init-sheet` command: tabs, headers, status/media dropdowns, `publish_at` format

### Phase 3: Platforms
- [x] 3.1 `graph.py`: pinned-version client, error classification, transient retry
- [x] 3.2 `facebook.py`: text/link/photo + permalink
- [x] 3.3 `instagram.py`: image container, wait for FINISHED, publish, permalink
- [x] 3.4 `telegram.py`: assist message (media + caption), no token in errors

### Phase 4: Runner
- [x] 4.1 `selector.py`: due / missed / exhausted / stale
- [x] 4.2 `runner.py`: claim, per-platform publish, immediate write-back, final status, report
- [x] 4.3 Dry run (no writes, no API calls)
- [x] 4.4 Idempotency tests: crash after FB before IG; stale posting; rerun skips filled IDs

### Phase 5: CLI + automation
- [x] 5.1 `validate`, `publish` (exit codes 0/1/2), `doctor` (config, sheet, tokens)
- [x] 5.2 `.github/workflows/ci.yml` + `publish.yml` (cron 7,37, concurrency, dry-run input)

### Phase 6: Go live (needs you)
- [ ] 6.1 Meta dev-mode app, System User token, Telegram bot + chat id
- [ ] 6.2 Private GitHub repo + secrets; manual dry run; 3 real rows

### Later (one-pager order)
- [ ] 7 Feed autopilot: RSS/YouTube to rows (Feeds tab, GUID dedupe, slot times)
- [ ] 8 Video: FB video/Reels, IG Reels with status polling, media host
- [ ] 9 TikTok / YouTube API audits; move them from assisted to automatic if granted

## Phase 10: Web + mobile app (Supabase)

Decision (2026-10-11): replace the Google Sheet with Supabase; free-tier stack.

| Part | Choice |
|---|---|
| Database, auth, media | Supabase Free (Postgres + RLS, email sign-in, public `media` bucket) |
| Web app | Vite + React + TypeScript SPA in `web/`, installable PWA (manifest + small service worker) |
| Hosting | Cloudflare static (free, commercial use allowed) |
| Publisher | Unchanged Python runner on GitHub Actions; new Supabase data layer |

### Design decisions
- **Runner, validation, adapters unchanged.** Only the repository changes. `posts.num` (identity int) plays the
  role of the sheet row number.
- **Backend switch:** `SUPABASE_URL` set → Supabase; else the Google Sheet (kept working until the switch).
- **Every row has `owner_id`; RLS = owner only.** One user today, ready for more later. Publisher uses the
  service-role key (GitHub secret), which bypasses RLS.
- **No Meta tokens in the database.** `accounts.token_env` still names a GitHub secret.
- **Public media bucket, uploads only into the user's own folder.** Meta must fetch media by public URL;
  paths are random UUIDs. Disable public sign-ups so strangers can't upload.
- **Composer checks are a TS port of `validation.py`** for instant feedback; the publisher still validates.
- **No router or PWA libraries.** Hash routing and a hand-written service worker are a few lines each.

### Tasks
- [ ] 10.1 `supabase/migrations/0001_init.sql`: accounts, posts, runs, RLS, storage bucket + policies
- [ ] 10.2 `supabase_repo.py`: load/write over PostgREST with httpx; type conversion to/from Post cells; tests
- [ ] 10.3 Config + CLI switch to Supabase when `SUPABASE_URL` is set; publisher writes a `runs` row
- [ ] 10.4 `web/` scaffold: Vite React TS, Supabase client, sign-in, hash routes, design tokens from the mockup
- [ ] 10.5 Queue screen (posts by day, platform states, Needs you, Last run, Connections)
- [ ] 10.6 Composer: form, media upload to Storage, platform tiles, live checks (TS validation + tests)
- [ ] 10.7 Handoff screen (mobile) + "I posted it"; Telegram message links to it
- [ ] 10.8 Accounts screen (add/edit FB Page, IG user, token secret name, time zone)
- [ ] 10.9 PWA manifest, icons, service worker; phone-width pass
- [ ] 10.10 Delete media from Storage once every platform of a post is done
- [ ] 10.11 Go live (needs you): create Supabase project, apply migration, disable sign-ups, deploy web to
  Cloudflare, add `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` secrets, retire the Sheet
