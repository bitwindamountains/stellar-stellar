# PostPilot
Shown to users (and on TikTok) as **Stellar Stellar**; code, repo and storage keys keep the PostPilot name.

Write a post once in the web/phone app. A GitHub Action publishes due posts to your Facebook Pages, Instagram and
X, sends TikTok videos to your drafts, writes back the post links, and never double-posts. Posts for your personal
Facebook profile, YouTube or Shopee arrive in Telegram at post time, with the media and caption ready to share.

Status: live. See `PROGRESS.md`.

## Quick start (publisher)
```bash
uv sync
cp .env.example .env          # fill in values
uv run --env-file .env postpilot doctor
uv run --env-file .env postpilot validate
uv run --env-file .env postpilot publish --dry-run
```

A filled platform ID on a post means that platform is done and is never posted again. If a post ends up
`failed` with "check if it posted", look at the platform first; only repost it if it is missing.
A real `publish` on your laptop needs `--local`; pause the GitHub schedule first, or two runs could both post it.

## Setup
1. **Supabase** (free): create a project, then run **every** file in `supabase/migrations/` in the SQL editor, oldest
   first (or `supabase db push` with the Supabase CLI). The app needs all of them.
   Under Authentication: turn **off** "Allow new users to sign up", then add yourself under Users.
2. **Web app**: in `web/`, copy `.env.example` to `.env` with the project URL and *publishable* key, then
   `npm install` and `npm run dev`. Deploy: Cloudflare Pages (or Workers static assets) with build command
   `npm run build`, output `dist`, root `web`, and the same two `VITE_` variables. Add the deployed URL to
   Supabase Authentication > URL Configuration (Site URL and Redirect URLs) so sign-in links work.
3. **Meta / X / TikTok**: connect them from the app's Accounts page (see `docs/superpowers/specs/2026-10-28-connect-and-post-design.md`).
   A Page token in a GitHub secret named by the account's `token_env` (e.g. `META_TOKEN_MAIN`) also works for Meta.
4. **Telegram**: create a bot with @BotFather (gives `TELEGRAM_BOT_TOKEN`), send it a message, then read your chat
   id from `https://api.telegram.org/bot<token>/getUpdates`.
5. **GitHub**: use a **private** repo. Add secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_CHAT_ID` (and any `META_TOKEN_*`, also listed in `.github/workflows/publish.yml`), and variables
   `META_GRAPH_VERSION` and `WEB_APP_URL`. The service-role key bypasses all access rules: keep it only in GitHub
   secrets, never in `web/`. Run the `publish` workflow manually (dry run is the default), then let it run on its own.
6. On your phone, open the app and use "Add to Home Screen".

### Posting on time
GitHub's 30-minute schedule really runs every few hours. A database timer (`dispatch_due`, every 10 minutes) and
"Post now" start the workflow as soon as a post is due. They need one fine-grained GitHub token (this repo only,
**Actions: read and write**) stored in Supabase Vault:
`select vault.create_secret('<token>', 'postpilot_github_token');`
Deploy `supabase/functions/dispatch` with JWT verification on; it needs no secrets of its own.
