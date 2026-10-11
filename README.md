# PostPilot

Plan posts in a Google Sheet. Every 30 minutes a GitHub Action publishes due rows to your Facebook Pages and
Instagram, writes back the post links, and never double-posts. Rows for your personal Facebook profile, TikTok or
YouTube arrive in Telegram at post time, with the media and caption ready to share.

Status: in development. See `tasks/plan.md`.

## Quick start
```bash
python -m uv sync
cp .env.example .env          # fill in values
python -m uv run --env-file .env postpilot init-sheet
python -m uv run --env-file .env postpilot validate
python -m uv run --env-file .env postpilot publish --dry-run
```

## Sheet
Run `init-sheet` once. Then fill in:

- **Accounts**: `account` (any short name), `fb_page_id`, `ig_user_id`, `token_env` (the *name* of the env var or
  secret holding that Page's token, e.g. `META_TOKEN_MAIN`), `timezone` (blank = Asia/Manila).
- **Posts**: `account`, `platforms` (comma list of `facebook, instagram, fb_profile, tiktok, youtube`),
  `publish_at` (`2026-10-05 18:00`, account time zone), `caption`, `media_type` (`none`/`image`/`video`),
  `media_urls` (public https link), `link` (Facebook only). Set `status` to `scheduled` when it's ready.

PostPilot fills `status`, `attempts`, `claimed_at`, the ID and permalink columns, `tg_message_id`, `last_error`
and `posted_at`. A filled ID means that platform is done for that row and is never posted again.

If a row ends up `failed` with "check if it posted", look at the platform first. Only reschedule it if the post
is missing.

**Two rules that keep posts from doubling or landing in the wrong row:**
- Never run `publish` (without `--dry-run`) on your laptop while the GitHub schedule is on. Two runs at the
  same time can both post the same row.
- Add new posts at the bottom. Don't insert, delete or sort rows in the minute around :07 and :37, when a run is
  writing results back by row number.

## Go-live setup
1. **Google**: create a service account, download its JSON key, share the Sheet with its email (Editor).
2. **Meta**: create a Business-type app in developer mode (no App Review needed for accounts where you have a
   role). Link IG to the Page. Get a System User or long-lived Page token with `pages_show_list`,
   `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`.
   Find IDs with `GET /me/accounts` and `GET /{page-id}?fields=instagram_business_account`.
3. **Telegram**: create a bot with @BotFather (gives `TELEGRAM_BOT_TOKEN`), send it a message, then read your chat
   id from `https://api.telegram.org/bot<token>/getUpdates`.
4. Locally: fill `.env`, then run `doctor`, `validate` and `publish --dry-run`.
5. **GitHub**: use a **private** repo. Add secrets `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEET_ID`,
   `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` and one `META_TOKEN_*` per account (also listed in
   `.github/workflows/publish.yml`). Add variable `META_GRAPH_VERSION`. Run the `publish` workflow manually (dry
   run is the default), then let the schedule take over.

Timing: posts go out within about 30 minutes of `publish_at` (GitHub cron can start late when busy).
