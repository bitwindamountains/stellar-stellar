# First comment + simple post stats

_2026-10-30. Status: reviewed, awaiting approval._

## Why
- **First comment**: the user wants to put their own comment under a post, mainly affiliate links or anything
  they'd rather not have in the caption. Today they'd have to open Facebook/Instagram and type it by hand.
- **Stats**: the user wants to see, inside PostPilot, how a post did: views or reach, likes, comments, shares, and
  roughly the top 5 comments. Personal use, one person; "simple" is the brief.

## Goals
1. An optional **First comment** field in the Composer. After a Facebook Page or Instagram post publishes, the
   publisher posts that text as a comment on it, from the Page / IG account.
2. For by-hand platforms (personal FB profile, TikTok, YouTube), the comment appears as its own **Copy comment**
   button on the Handoff page and as its own block in the Telegram message, to paste after posting.
3. Per-post stats for FB Page and IG posts in the **Posted** tab: views/reach, likes (FB: reactions), comments,
   shares (FB only), plus the top 5 comments (author, text, like count; most-liked first).

## Non-goals (for now)
- X: no comment (it would be a self-reply, paid per call) and no stats (paid reads).
- TikTok / YouTube stats (TikTok needs another app review).
- Replying to or moderating comments; per-platform first comments; charts, totals, best-time-to-post.
- A "refresh stats now" button.

## Anti-goals (would be a failure even if it works)
- Posting a post twice, or the same comment twice, because a comment failed or a run retried.
- A comment or stats failure turning a successfully published post into `failed`, or blocking other posts.
- Stats fetching making publish runs slow or flaky (the publish path must not depend on it).
- Exposing tokens: no new token handling in `web/`; the browser only reads what the publisher stored.

## Constraints (from the project rules, CLAUDE.md)
- Idempotency: a filled ID means never repeat that call. Each comment gets its own ID column, written back
  immediately after it succeeds.
- No call repeated within a run; retryable failures become `partial` and later runs retry only what's missing.
  `unknown` outcomes become `failed` for a human check.
- Runner knows no Graph API details; adapters know nothing about the store.
- Mirrors stay in step: `web/src/validation.ts` ↔ `validation.py`, `web/src/content.ts` ↔ `Post.text_for`.
- Schema change = new migration file, RLS owner-only, applied to project `wsclesrylegjsyfxaamr`.
- Tests never call real APIs. No new dependencies.
- Telegram lengths are UTF-16 units after HTML parsing (the comment block counts toward the message limit).

## Decided
### First comment
- **Data**: new column `posts.first_comment text not null default ''`, plus `fb_comment_id` and
  `ig_comment_id` (`text not null default ''`). One comment for all platforms (not per-platform variants).
- **Limits**: validate in both mirrors. Instagram comments max 2,200 characters (same as caption), and Instagram
  rejects comments with more than 4 hashtags or 2 @mentions per Meta's docs; the builder confirms current limits
  and validates whatever Meta enforces so failures show in the Composer, not at publish time.
- **Publish flow** (per API platform, FB Page and IG only): publish the post as today and save its ID. Then, if
  `first_comment` is set and that platform's comment ID is empty, post the comment and save its ID immediately.
  On a later run, a platform whose post ID is filled but whose comment ID is empty gets only the comment.
  A post is `posted` only when posts and comments are all done.
- **Failure handling**: a retryable comment failure → `partial` (the post itself is not reposted, since its ID is
  filled), retried by later runs up to `max_attempts`. A permanent or `unknown` comment failure, or running out of
  attempts on a comment, ends the post as **`posted`** (it is live; `posted_at` stamped, so it shows in Posted and
  gets stats) with `last_error` saying e.g. "Comment not added on Instagram: add it by hand" (or "Reconnect Meta in
  Accounts to allow comments"). The app shows that note on the post. There is **no Retry for a comment**: once a
  post is `posted` the publisher never touches it again, so a hand-added comment can't be duplicated.
  _(Builder's-check answer; my call: a live post shouldn't read as failed, and no retry rules out duplicates.)_
- **Editing after it's live**: the First comment field locks (read-only, with a one-line note) once any FB/IG part
  of the post has published. Adding or changing a comment on an already-live post isn't supported; the user does
  it in the app itself. _(My call: keeps the publisher from ever reopening `posted` rows.)_
- **Graph calls**: FB `POST /{post-id}/comments` (message); IG `POST /{ig-media-id}/comments` (message). These
  live in `facebook.py` / `instagram.py`, called by the runner through a new commenter mapping like `publishers`.
- **By hand**: the Handoff page shows **Copy comment** under each by-hand platform's caption when
  `first_comment` is set, including X when it goes to the phone (account without an X login). The Telegram assist
  message adds a "First comment:" block. The comment doesn't count toward any caption length limit.
  _(My call: the "no X comment" non-goal is about the paid API call, not posting by hand.)_
- **Composer**: a "First comment (optional)" textarea under the caption, with a one-line hint ("Posted as a
  comment on Facebook and Instagram; copy it on your phone for the others. Instagram links aren't clickable.").
  The per-platform preview shows it under the post.

### Stats
- **Who fetches**: the publisher (tokens never leave the server). After the publish part of each non-dry run, it
  refreshes stats for FB Page / IG posts with `posted_at` in the last **7 days** and a real (not by-hand) post ID
  for that platform, then stops refreshing that post.
  A stats failure is logged in the run output and never changes a post's status or the run's exit code.
- **Storage**: new column `posts.stats jsonb not null default '{}'`, shaped
  `{facebook|instagram: {as_of, views?, reach?, likes, comments, shares?, top_comments: [{author, text, likes,
  at}]}}`. Missing metrics are simply absent (shown blank), never an error.
- **Metrics**: Instagram: `like_count`, `comments_count` (media fields), and `reach` / `views` (media insights).
  Facebook: reactions total, comments total, shares, and post reach/views from post insights. Meta has been
  retiring and renaming metrics (IG "impressions" → "views"; several FB post metrics retired), so the builder checks
  current names against Meta's docs at build time and requests only metrics that still exist.
- **Top comments**: fetch the post's top-level comments with like counts, sort by likes (ties: newest), keep 5,
  store author name, text, likes, time.
- **Web**: Posted tab rows show a compact line (e.g. "1.2k views · 48 likes · 6 comments · 2 shares") per platform
  and "as of 3 h ago". Tapping opens the post's details with the top 5 comments. Nothing is shown for posts or
  platforms without stats.
- Web edits must never overwrite `stats` or the comment IDs (Composer only writes the fields it owns).

### Permissions (one reconnect)
Add to the Meta Connect scope in `supabase/functions/connect`: `pages_manage_engagement` (FB comments),
`instagram_manage_comments` (IG comments, reading IG comments), `instagram_manage_insights` (IG reach/views),
`read_insights` (FB post insights). The app is in Development mode, so the admin can grant these without review;
the user reconnects Meta once from Accounts. Until then, comment calls fail with a permission error: treat that as
permanent with the message "Reconnect Meta in Accounts to allow comments", and stats skip silently.

## Left to the builder
- Exact column names, adapter function names and module placement, consistent with existing patterns.
- Whether stats fetching lives in a new `stats.py` orchestrator (store-agnostic, adapters injected) or inside
  `cli.py`; the runner rules apply either way.
- How many posts to refresh per run (a cap to keep runs short is fine).
- The exact layout of the stats line and details view, matching current Queue styles; must work at phone width.
- Whether the Google Sheet backend gets the feature (it's legacy: skipping it, with a clear validation message if
  `first_comment` is used there, is fine).
