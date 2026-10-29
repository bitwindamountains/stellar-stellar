# PostPilot progress

_Last updated: 2026-10-29_

## Where things stand
Everything is merged to `main` (PRs #1–#9) and the web app is live. TikTok works in Sandbox: Connect works, and two
real uploads returned `SEND_TO_USER_INBOX`, but no draft showed up in the TikTok app. So the production review (drafts
only: Login Kit, `user.info.basic`, `video.upload`) was submitted on 2026-10-29. Site verification file, `/terms` and
`/privacy` are live (PR #9). After approval: put the production key/secret into Supabase + GitHub, reconnect, test
once. Direct Post (`video.publish`) needs TikTok's posting screen plus its own audit: later.

**Meta is live** (2026-10-29): app in Development mode, connected on account `fb`; the first real FB + IG post went
out. **PR #10** (QoL): one post can go to several accounts (rows share `posts.group_id`, migration applied); the Queue
updates live (Realtime) with a "Going out" panel, Open links, a Posted tab and caption search; tapping a week day
jumps to it or starts a post for that day; the Composer has per-account platform toggles and a per-platform preview.
Next: X developer app, then YouTube upload (private until Google's audit).

| Part | State |
|---|---|
| Publisher (Python, GitHub Actions every 30 min) | Done. 186 tests. FB, IG, X automatic; TikTok to drafts. |
| Supabase schema + RLS | Applied to project `wsclesrylegjsyfxaamr` (private, own project); RLS verified with simulated users. |
| `dispatch` function (instant Post now) | Deployed (v2), rejects anyone not signed in. Needs `GITHUB_TOKEN`/`GITHUB_REPO` secrets. |
| Web app (PWA) | Done. 34 tests. Live on Cloudflare Workers. |
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
- **Connect logins (PR #5)**: Connect buttons (Meta, X, TikTok) via the `connect` function, tokens in Vault,
  X posting, Shopee by hand. Code review (10 fixes) done.
- **Deploy (PR #6)** and **TikTok drafts (PR #7)**: TikTok uploads to your inbox (`video.upload`, no app audit
  for Direct Post); the caption comes to Telegram and the handoff page; you finish it in TikTok.

## Live (2026-10-28)
- Web app: https://postpilot.postpilot-web.workers.dev (Cloudflare Workers static assets; redeploy from `web/`:
  `npm run build && npx wrangler deploy`).
- GitHub variables set: `META_GRAPH_VERSION=v23.0`, `WEB_APP_URL`. Scheduled publish runs are on; a dry run on main
  read the live database cleanly.
- Still to set: Supabase Edge Function secret `WEB_APP_URL` (needed for Connect), the platform app secrets, and
  optionally `GITHUB_TOKEN`/`GITHUB_REPO` for instant Post now (otherwise posts go out within 30 minutes).

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

## Connect logins (live code, needs you)
Design: `docs/superpowers/specs/2026-10-28-connect-and-post-design.md`.
1. Done 2026-10-28: project restored, `20261028000000_connections.sql` applied (Vault round trip, grants and RLS
   checked), `connect` deployed (v3, TikTok scope `video.upload`, JWT verification off; it checks the user itself). Free projects pause after a
   week idle: restore from the dashboard if runs start failing.
2. Make the developer apps; the redirect URI is `https://wsclesrylegjsyfxaamr.supabase.co/functions/v1/connect`:
   - Meta (developers.facebook.com): Facebook Login for Business; you as admin can use it in Development mode.
   - X (developer.x.com): OAuth 2.0, confidential client, read+write; buy pay-per-use credits and set a spend cap
     (~$0.015 a post, $0.20 with a link).
   - TikTok (developers.tiktok.com): app with platform Web (`https://postpilot.postpilot-web.workers.dev`),
     products Login Kit (redirect URI above) + Content Posting API (Direct Post off), scopes `user.info.basic,
     video.upload` only. Start in Sandbox and add your TikTok account as a target user; sandbox has its own
     client key/secret. Open question: TikTok's docs disagree on whether sandbox allows `video.upload`. If
     Connect or the upload fails on scope/permission, submit the production app for review (needs privacy and
     terms URLs, which the app doesn't have yet, plus a screen recording). At most 5 pending drafts per 24 h.
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
