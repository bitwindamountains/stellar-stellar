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
- [ ] 1.3 `validation.py`: rule list from blueprint 10.1 adjusted for assisted platforms

### Phase 2: Sheet layer
- [ ] 2.1 `sheet.py`: header mapping, row parsing, cell-update building (pure, tested)
- [ ] 2.2 `SheetRepository` (gspread: load, batch write) + `FakeRepository` for tests
- [ ] 2.3 `init-sheet` command: tabs, headers, status/media dropdowns, `publish_at` format

### Phase 3: Platforms
- [ ] 3.1 `graph.py`: pinned-version client, error classification, transient retry
- [ ] 3.2 `facebook.py`: text/link/photo + permalink
- [ ] 3.3 `instagram.py`: image container, wait for FINISHED, publish, permalink
- [ ] 3.4 `telegram.py`: assist message (media + caption), no token in errors

### Phase 4: Runner
- [ ] 4.1 `selector.py`: due / missed / exhausted / stale
- [ ] 4.2 `runner.py`: claim, per-platform publish, immediate write-back, final status, report
- [ ] 4.3 Dry run (no writes, no API calls)
- [ ] 4.4 Idempotency tests: crash after FB before IG; stale posting; rerun skips filled IDs

### Phase 5: CLI + automation
- [ ] 5.1 `validate`, `publish` (exit codes 0/1/2), `doctor` (config, sheet, tokens)
- [ ] 5.2 `.github/workflows/ci.yml` + `publish.yml` (cron 7,37, concurrency, dry-run input)

### Phase 6: Go live (needs you)
- [ ] 6.1 Meta dev-mode app, System User token, Telegram bot + chat id
- [ ] 6.2 Private GitHub repo + secrets; manual dry run; 3 real rows

### Later (one-pager order)
- [ ] 7 Feed autopilot: RSS/YouTube to rows (Feeds tab, GUID dedupe, slot times)
- [ ] 8 Video: FB video/Reels, IG Reels with status polling, media host
- [ ] 9 TikTok / YouTube API audits; move them from assisted to automatic if granted
