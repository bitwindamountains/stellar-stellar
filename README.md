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
