# PostPilot progress

_Last updated: 2026-10-12_

## Where things stand
Code is complete for personal use and merged to `main` (PRs #1–#3). PR #4 (web polish) is open.
Nothing has posted for real yet: go-live needs your accounts and keys (below).

| Part | State |
|---|---|
| Publisher (Python, GitHub Actions every 30 min) | Done. 127 tests. Scheduled runs skip until configured. |
| Supabase schema + RLS | Applied to project `wsclesrylegjsyfxaamr` (private, own project); RLS verified with simulated users. |
| `dispatch` function (instant Post now) | Deployed (v2), rejects anyone not signed in. Needs `GITHUB_TOKEN`/`GITHUB_REPO` secrets. |
| Web app (PWA) | Done. 27 tests. Runs locally (`web/.env` set). Not deployed yet. |
| GitHub repo | `bitwindamountains/PostPilot`, private. Secret set: `SUPABASE_URL`. |

## Done
- **Phases 0–5**: publisher (FB text/link/photo, IG image), Telegram handoff, validation, dry run, doctor, CI.
- **Phase 10**: Supabase backend, web app (queue, composer, handoff, accounts), PWA, media uploads.
- **Phase 11 (usability round 1)**: per-platform captions/hashtags/YouTube title, Post now / Schedule with quick
  times, Ctrl+Enter, remembered choices, draft autosave, paste/drop media, Android share target, Post again,
  one-tap Retry, live post links, 7-day strip, 4 pm Telegram nudge.
- **Codex review fixes (19 over 3 rounds)**: conditional publisher claim (edits/deletes can't be beaten by a run),
  JPEG for Instagram, delete/save never touch a post being published, unresolved posts always visible, Telegram
  length counted like Telegram, and more. See PR #3.
- **Polish (PR #4)**: account rows layout fix, quieter visuals, phone layout fixes, plain wording.

## Go-live checklist (needs you)
1. Supabase: Authentication → turn off public sign-ups; Users → Add user (email + password, auto-confirm).
2. GitHub → Settings → Secrets and variables → Actions:
   - Secrets: `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, one `META_TOKEN_*` per
     account (and a matching line in `publish.yml`).
   - Variables: `META_GRAPH_VERSION`, `WEB_APP_URL` (after deploy).
3. Instant Post now: fine-grained GitHub token (this repo, Actions read/write) → Supabase Edge Function secrets
   `GITHUB_TOKEN` and `GITHUB_REPO` = `bitwindamountains/PostPilot`.
4. Deploy `web/` to Cloudflare Pages (root `web`, build `npm run build`, output `dist`, the two `VITE_` values);
   add the URL in Supabase → Authentication → URL Configuration.
5. Run the `publish` workflow manually (dry run by default), then one real post.

## Connect logins (branch `feat/connect-accounts`, needs you)
Design: `docs/superpowers/specs/2026-10-28-connect-and-post-design.md`. Code + tests done; not live yet.
1. Restore the paused Supabase project, then apply `20261028000000_connections.sql` and deploy the `connect`
   function with JWT verification **off** (it checks the user itself).
2. Make the developer apps; the redirect URI is `https://wsclesrylegjsyfxaamr.supabase.co/functions/v1/connect`:
   - Meta (developers.facebook.com): Facebook Login for Business; you as admin can use it in Development mode.
   - X (developer.x.com): OAuth 2.0, confidential client, read+write; buy pay-per-use credits and set a spend cap
     (~$0.015 a post, $0.20 with a link).
   - TikTok (developers.tiktok.com): Login Kit + Content Posting API. Posts stay private until the app passes audit;
     then set the GitHub variable `TIKTOK_PRIVACY_LEVEL=PUBLIC_TO_EVERYONE`.
3. Edge Function secrets: `WEB_APP_URL, META_APP_ID, META_APP_SECRET, X_CLIENT_ID, X_CLIENT_SECRET,
   TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET`. GitHub secrets: `X_CLIENT_ID, X_CLIENT_SECRET, TIKTOK_CLIENT_KEY,
   TIKTOK_CLIENT_SECRET` (the publisher refreshes X/TikTok logins).
4. Accounts → pick an account → Connect each login. Shopee stays by hand (no posting API for apps).

## Not yet verified for real
Email/password sign-in, uploads, publisher reads/writes against live Supabase, Post now triggering a run,
Android share target, PNG→JPEG conversion on upload, the 4 pm nudge, copy buttons on a phone.

## Known limits / later
- Google Sheet backend: claim can't be conditional (Sheets has no conditional writes).
- A manual run between 4:00 and 4:30 pm can send the nudge twice.
- Image cleanup after automatic posts isn't done (only by-hand uploads are deleted).
- Not built: feed autopilot (RSS/YouTube → posts), FB/IG video and Reels, insights, AI captions, calendar view.
