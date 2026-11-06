# PostPilot progress

_Last updated: 2026-11-06_

## Where things stand
**Audit fixes (branch `fix/audit-2026-11-06`, 2026-11-06)**: a repo audit found posts going out hours late (GitHub's
schedule ran every 4-10 h; the 10-minute timer had no token; one post already `missed`). Fixed: `dispatch_due()` is
now the only thing that starts the workflow early ("Post now" calls it over RPC, so the GitHub token lives only in
Vault) and stops poking GitHub 3 h past due (migration `20261106000000`, applied; `dispatch` v8 deployed). Uploads of
automatic-only posts are now cleaned up too, a week after posting (a Post again draft may still use them). The Google Sheet store and `gspread` are gone. `pg_net` moved to the
`extensions` schema (migration `20261106000100`, applied). **Needs you**: put the GitHub token in Vault (On-time
posting below) and turn on leaked-password protection (Auth → Providers → Email) if your plan has it.

Everything is merged to `main` (PRs #1–#17) and the web app is live. TikTok works in Sandbox: Connect works, and two
real uploads returned `SEND_TO_USER_INBOX`, but no draft showed up in the TikTok app. So the production review (drafts
only: Login Kit, `user.info.basic`, `video.upload`) was submitted on 2026-10-29. Site verification file, `/terms` and
`/privacy` are live (PR #9). After approval: put the production key/secret into Supabase + GitHub, reconnect, test
once. Direct Post (`video.publish`) needs TikTok's posting screen plus its own audit: later.

**Meta is live** (2026-10-29): app in Development mode, connected on account `fb`; the first real FB + IG post went
out. **PR #10** (QoL): one post can go to several accounts (rows share `posts.group_id`, migration applied); the Queue
updates live (Realtime) with a "Going out" panel, Open links, a Posted tab and caption search; tapping a week day
jumps to it or starts a post for that day; the Composer has per-account platform toggles and a per-platform preview. **PR #11**: each account offers only
the platforms it has a login for (e.g. `worldpiece164` = TikTok only); by-hand platforms (FB profile, YouTube,
Shopee) sit in one "To your phone" block. Not yet tried on live data: saving/editing a multi-account post, and
Realtime updates in the Queue.

Next (waiting on you): X developer app (`X_CLIENT_ID`/`X_CLIENT_SECRET` into Supabase + GitHub, then Connect X),
then YouTube upload (private until Google's audit); TikTok review result. Ideas parked: dark mode, Shopee/Lazada
affiliate links.

| Part | State |
|---|---|
| Publisher (Python, GitHub Actions every 30 min) | Done. 284 tests. FB, IG (posts + Reels), X (text + video) automatic; TikTok to drafts. |
| Supabase schema + RLS | Applied to project `wsclesrylegjsyfxaamr` (private, own project); RLS verified with simulated users. |
| `dispatch` function (instant Post now) | Deployed (v8), rejects anyone not signed in, calls `dispatch_due()`. No secrets of its own. |
| Web app (PWA) | Done. 98 tests. Live on Cloudflare Workers. |
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
- **Screens redesign (branch `feat/app-screens`, 2026-10-30)**: the one big Queue became five tabs: **Today**
  (needs you + going out today), **Planned** (week strip, selected day, drafts), **(+) New post** (write first,
  settings rows open sheets), **History** (posted feed with search/filters; tap a post for how it did) and
  **Accounts** (now also the last-run line and Sign out, which left the nav). Phone: floating glass tab bar with
  the raised (+); desktop: glass sidebar. Look: Liquid Glass over a stellar night sky (one shared starfield);
  older browsers fall back to solid glass. Old Queue screen and its CSS removed.

## Video to Reels (PR #17, merged 2026-11-05)
Video now goes to Facebook Page Reels, Instagram Reels and X video automatically. TikTok still gets inbox drafts;
YouTube Shorts and the FB profile stay by hand (Telegram + handoff page).
- **Cover image** (optional): `posts.cover_url`, migration `20261104000000_video_cover.sql` (applied to the live
  project). IG uses it; the FB Reel cover is best-effort via thumbnails; X shows its own frame; Telegram sends it with
  by-hand clips; the handoff page shows it.
- **Length check** in the Composer, from the clip in the browser: FB 3-90 s, IG 3 s-15 min, X up to 140 s. The FB/IG
  limits are not yet confirmed against Meta's docs. A length the browser can't read is not blocked.
  FB Reels also need a vertical clip at least 540 px wide (checked only when the browser reads the size).
  The measured length and size are saved with the post (`video_seconds`, `video_width`, `video_height`, migration
  `20261105000000_video_meta.sql`, applied), so the publisher re-checks the same limits before posting. Edit and
  Post again keep them; pasted links have none and go unchecked.
- **Never twice**: a FB Reel that was accepted but is still processing (or failed processing) keeps its ID and is
  marked failed for a check. "Repost only what failed" on the post's detail page clears just those platforms and
  requeues.
- **Storage cleanup** lives only in the publisher: every real run sweeps posts that are posted and handed off,
  deletes their own uploads unless a row that isn't finished still uses them, and drops the dead links. "I posted it"
  only marks the post done, so files go at the next run (up to 30 min later); a failed delete is retried.
- The publish workflow timeout went from 10 to 30 minutes (video uploads are slow). A run starts no new post
  after 20 minutes (claimed rows go back for the next run). Each video wait stops after 5 minutes, and all waits
  end 25 minutes into the job. A FB Reel with under 2 minutes of wait left isn't started: it goes out next run
  (this uses one retry attempt).
- A FB Reel's ID is saved the moment Facebook accepts it, with a "facebook: …" mark, so a run killed while
  waiting leaves the row failed for a check (never posted) and Repost offered.
- `media_type` is matched in any case ("Video" works). Facebook upload (rupload) errors show their own reason
  (`debug_info`); the ones Facebook marks retriable are retried.
- A failed save of a Reel's ID stops the run (the row is then found stale and failed for a check), so a Repost can't
  post the Reel twice.
- **Not verified live**: no real Reel or X video has been posted. One developer report says rupload needs
  `Offset`/`file_size` headers even with `file_url`; we don't send them: check this first if the first Reel fails.
  Codex never reviewed the final version (usage limit). X is untested until the developer app is
  connected. One real test post, only when you say so. The local dry run wasn't run (no `.env` on this PC).

## Live (2026-10-28)
- Web app: https://postpilot.postpilot-web.workers.dev (Cloudflare Workers static assets; redeploy from `web/`:
  `npm run build && npx wrangler deploy`).
- GitHub variables set: `META_GRAPH_VERSION=v23.0`, `WEB_APP_URL`. Scheduled publish runs are on; a dry run on main
  read the live database cleanly.
- Still to set: Supabase Edge Function secret `WEB_APP_URL` (needed for Connect), the platform app secrets, and
  the GitHub token in Vault (On-time posting below).

## Go-live checklist (needs you)
1. Supabase: Authentication → turn off public sign-ups; Users → Add user (email + password, auto-confirm).
2. GitHub → Settings → Secrets and variables → Actions:
   - Secrets: `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, one `META_TOKEN_*` per
     account (and a matching line in `publish.yml`).
   - Variables: `META_GRAPH_VERSION`, `WEB_APP_URL` (after deploy).
3. On time + instant Post now: the GitHub token in Vault (On-time posting below).
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

## First comment + post stats (2026-10-30, needs you)
Design: `docs/superpowers/specs/2026-10-30-first-comment-and-stats-design.md`; plan alongside it.
- **First comment**: optional box in the Composer; posted under FB Page / IG posts right after they publish. Each
  comment's ID (or a give-up marker `not-added` / `unclear`) is saved at once, so nothing ever comments twice.
  A failed comment never makes a live post `failed`: it ends `posted` with a note ("add it by hand"). By-hand
  platforms get a "First comment" block in Telegram and a Copy comment button on the handoff page.
- **Stats**: after each real run the publisher refreshes FB/IG views, reach, likes, comments, shares and the top 5
  comments for 7 days after posting (max 20 posts, 60 s budget; a stats problem never fails the run). Shown in
  the Posted tab.
- Migration `20261031000000_first_comment_stats.sql` is applied.
- To switch it on: deploy `connect` (new Meta permissions: `pages_read_user_content`, `pages_manage_engagement`, `instagram_manage_comments`,
  `instagram_manage_insights`, `read_insights`; admins/testers only until App Review, fine in Development mode),
  then Accounts → reconnect Meta once. Until then comments end "reconnect Meta" and stats are skipped.
- Unverified until a real run: the FB metric names `post_media_view` / `post_total_media_view_unique` (Meta's
  replacements for retired metrics); a wrong name only leaves that number blank.

## On-time posting (needs you)
GitHub's 30-minute schedule really runs every 4–10 hours, and a post more than 3 hours late is marked missed. Migration `20261030000000_dispatch_due.sql` adds a
Supabase cron job that starts the publish workflow every 10 minutes while a post is due, and a `nudges` table so the
4 pm Telegram nudge goes out once a day on the first run after 4 pm. To switch the cron job on, put a fine-grained
GitHub token (this repo, "Actions: read and write") in Vault, in the Supabase SQL editor:
`select vault.create_secret('<token>', 'postpilot_github_token');`
"Post now" uses the same token (the `dispatch` function calls `dispatch_due()`). Check after the next due post:
`gh run list --workflow publish.yml` shows a `workflow_dispatch` run within about 10 minutes.

## Not yet verified for real
Email/password sign-in, uploads, publisher reads/writes against live Supabase, Post now triggering a run,
Android share target, PNG→JPEG conversion on upload, the 4 pm nudge, copy buttons on a phone.

## Known limits / later
- Uploads of deleted posts and abandoned drafts are never cleaned up (the sweep only sees finished rows).
- Big X video uploads aren't bounded by the run deadline (each chunk has its own 300 s timeout).
- Not built: feed autopilot (RSS/YouTube → posts), insights, AI captions, calendar view.
