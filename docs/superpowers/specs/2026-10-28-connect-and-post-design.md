# Connect accounts and post: Facebook, Instagram, X, TikTok, Shopee

Request: "make it support to be able to login in tiktok, fb, shoppee, x, ig and be able to post." The user skipped
the questions, so every choice below is Claude's call unless marked otherwise.

## Intent
Today a Facebook Page/Instagram token has to be made by hand and pasted into a GitHub secret. Instead: tap
**Connect** on the Accounts page, log in on the platform, done. Then posts go out automatically to every platform
that allows it.

## What each platform allows (checked 2026-10-28)
| Platform | Login | Posting | Limits |
|---|---|---|---|
| Facebook Page + Instagram | Facebook Login (one connect covers both) | automatic (existing adapters) | IG image must be JPEG; personal FB profile still by hand (no API exists) |
| X | OAuth 2.0 with PKCE | automatic: text, link, one image | Pay-per-use API since Feb 2026: about $0.015 per post, $0.20 with a link. Set a spend cap in the X console. |
| TikTok | Login Kit | automatic video when connected, else Telegram handoff as today | Until TikTok audits the app, posts are **private (Only me)** (`TIKTOK_PRIVACY_LEVEL`, default `SELF_ONLY`) |
| Shopee | none | by hand (Telegram + handoff page) | Shopee's Open Platform is for shop listings; no verified API for Feed/Video posts. Revisit if one appears. |

## Goals
- Connect / Disconnect buttons per account for Facebook (+IG), X, TikTok; shows who is connected.
- New platforms in the composer: X (automatic), Shopee (by hand). TikTok becomes automatic once connected.
- Expiring tokens (X 2 h, TikTok 24 h) refresh in the publisher; rotated refresh tokens are saved at once.
- Existing secret-name Meta tokens keep working (connection wins when both exist).

## Non-goals
X video, TikTok photo posts, Shopee API, YouTube API, carousels, multiple Pages per connect (if several Pages
come back and the account has no Page ID, the user types the Page ID first and reconnects).

## Anti-goals
- A token readable by the browser, logged, or put in an error message.
- A post published twice: TikTok sent to Telegram must count as done for TikTok (`tiktok_id = 'telegram'`).

## Design
- **Tokens** live in Supabase Vault. `public.connections` (owner RLS: select/delete own) holds platform, handle and
  the Vault secret id. Service-role-only SQL functions `save_connection` and `connection_tokens` write/read them;
  deleting a connection deletes its Vault secret (trigger). Tokens are stored as one JSON secret per connection.
- **OAuth**: Edge Function `connect` (JWT check done in code, like `dispatch`). `POST` with the user's session +
  `{platform, account_id}` returns the authorize URL; state + PKCE verifier sit in `oauth_states` (service role
  only, 10 min). `GET ?code&state` exchanges the code, saves the connection, and redirects to
  `WEB_APP_URL/#/accounts?connected=<platform>` or `?error=<plain text>`.
- **Publisher**: `Account.connected` (set of `meta`, `x`, `tiktok`). Runner sends a platform to its adapter when the
  account posts it by API (`Account.by_api`), else to Telegram. `oauth.py` refreshes; `x.py`, `tiktok.py` adapters
  use a shared `rest.call` helper. Adapters get a token, never the store.
- **Schema**: posts get `x_post_id, x_permalink, tiktok_id, tiktok_permalink`; platforms check adds `x`, `shopee`;
  old TikTok handoffs backfilled with `tiktok_id = 'telegram'`.
- **Secrets**: Edge Function: `META_APP_ID, META_APP_SECRET, X_CLIENT_ID, X_CLIENT_SECRET, TIKTOK_CLIENT_KEY,
  TIKTOK_CLIENT_SECRET, WEB_APP_URL`. GitHub: `X_CLIENT_ID, X_CLIENT_SECRET, TIKTOK_CLIENT_KEY,
  TIKTOK_CLIENT_SECRET` (refresh) and optional variable `TIKTOK_PRIVACY_LEVEL`.

## Validation (mirrored in `web/src/validation.ts`)
- X: needs X connected; weighted length ≤ 280 (links 23, CJK/emoji 2, like twitter-text); no video.
- Facebook/Instagram: need a token secret name **or** a Facebook connection.
- TikTok (connected): caption ≤ 2,200. Shopee: Telegram length check like other by-hand platforms.

## Left to the builder
Copy wording, button placement, test shapes.
