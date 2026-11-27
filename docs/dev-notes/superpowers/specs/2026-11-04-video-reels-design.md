# Video to Facebook Reels, Instagram Reels and X: design

_2026-11-04. Status: ready for your approval._

## Why
Video is most of the posting: 2–3 short vertical clips a day, made on the PC, and every clip goes to every platform.
Today the publisher refuses video for Facebook, Instagram and X (`validation.py` / `validation.ts`), so each clip goes
to Telegram and is posted to the Page and Instagram by hand, on top of TikTok and YouTube. That is the biggest
remaining chunk of hand work.

## Goal
Upload a clip once (plus an optional cover image) and it goes out automatically as:
- a **Reel on the Facebook Page**,
- a **Reel on Instagram**,
- a **video post on X**,

while TikTok keeps getting it as an inbox draft and YouTube Shorts / the FB profile keep going by hand through
Telegram and the handoff page. Same clip, same per-platform captions/hashtags/first comment the composer already has.

## The bar (from the user: "everything that would be different or wrong" would make them wince)
- What goes up is exactly what was written and uploaded: no re-encode, trim or caption change by us.
- **Never twice.** Same idempotency rules as now: a filled platform ID means never publish that platform again; IDs
  are written back the moment they exist.
- **"Posted" means live.** A platform counts as done only once the platform says the video is published.
- Unclear outcomes become `failed` for a human check, never a blind retry.
- Rule breaks (too long, too big, wrong shape) show in the composer **before** posting, not after a failed run.

## Non-goals
- Landscape/long-form video, FB feed videos (non-Reel), IG feed videos, Stories, carousels.
- Trimming, compressing or converting video. Files over 50 MB are refused in the composer as today.
- Automatic YouTube Shorts (still waiting on Google's audit) or TikTok Direct Post.
- Choosing a cover frame inside the app (only uploading a cover image).

## Anti-goals
- A post marked posted that never really went up.
- A Reel/video published twice because a retry didn't know the first one landed.
- A missing cover, or a platform that ignores the cover, blocking or failing a post.

## Cover image (user decided: upload own cover; platforms that can't take it use their own)
- Optional **Cover** image next to the video in the composer. Stored as a new nullable column `posts.cover_url`
  (new migration, RLS unchanged: owner-only). Uploaded to the same `media` bucket, converted to JPEG on upload the
  way Instagram images already are.
- Instagram Reel: passed as `cover_url`.
- Facebook Reel: not documented in the Reels publishing API. After publishing, try once to set it as the preferred
  thumbnail (the Video API `/{video-id}/thumbnails` call); any failure leaves Facebook's own pick and is only a note.
- X: not supported by the API; X shows its own frame.
- TikTok: chosen in the TikTok app as today.
- By-hand platforms: the cover is sent to Telegram with the clip and offered on the handoff page.
- A cover problem never fails or blocks a post.

## How each platform posts (the shape is decided; exact parameters are the builder's to confirm in current docs)
All three keep the existing split: harmless steps may retry, the one step that makes the post public is called once
(`safe=False`), and its ID is saved immediately.

**Instagram Reel.** Create a `REELS` container from the public `video_url` (+ `cover_url`, `share_to_feed=true`),
poll `status_code` until `FINISHED`, then `media_publish` once. Everything before `media_publish` is harmless to
repeat (an unpublished container just expires), so "still processing" at the end of the polling budget is a
`transient` error and a later run starts over with a new container. `ERROR`/`EXPIRED` is `permanent` with a plain
reason.

**X.** Chunked media upload (initialize / append / finalize, then status until processing succeeds) with the
existing OAuth 2.0 user token (`media.write` is already in the login's scopes), then create the post once with the
media ID. An unused uploaded media ID is harmless, so processing timeouts are `transient`. X is not connected yet
(developer app pending), so this is built and tested against mocked responses only.

**Facebook Page Reel.** `video_reels` start → upload from the hosted file URL (rupload, `file_url`) → finish with
`video_state=PUBLISHED` and the caption. Start and upload are harmless; **finish is the one unsafe call**, and the
video ID is saved the moment finish succeeds. Facebook processes after finish, so the publisher then polls the
video's status within the same run:
- published → save the permalink, done;
- processing error → `failed` with Facebook's reason (the ID stays, so it is never re-sent; the user reposts);
- still processing when the polling budget ends → `failed` with "Facebook accepted the Reel but was still
  processing; check it's on your Page". This follows the existing rule that unclear outcomes go to a human check.
  It should be rare for short clips.

**Reposting only what failed (user decided).** A post where a platform failed and the user has confirmed it isn't
live gets a **Repost** action that sends it again to **only the failed platforms**, never the ones that went out.
For a Facebook Reel stuck/failed after finish, confirming clears that platform's saved ID so the publisher may post
it again; the clip and cover are kept until that repost finishes. Builder picks whether this is a new action or
"Post again" opening with only the failed platforms ticked, as long as succeeded platforms can't be re-sent by
accident.

There is no new post status: processing happens inside one run. (This replaces the "still processing" state and the
30-minute limit floated in the conversation, which would have needed a new status and cross-run bookkeeping.)

## Where it fits in the code
- Adapters `facebook.py`, `instagram.py`, `x.py` gain the video path; the runner stays platform-agnostic
  (rule: runner must not know Graph API details).
- Validation mirrors (`validation.py` ↔ `web/src/validation.ts`): allow `media_type=video` for facebook, instagram
  and x; keep "one media file per post". The user's clips are **90 seconds or less**, which fits every platform, so
  a broken limit is rare: the composer reads the clip's duration and dimensions in the browser and **refuses to
  save** (a normal validation error, same as today) when any selected platform's limit is broken. No per-platform
  dropping. The publisher relies on the platform's own rejection for anything the browser didn't catch (a
  `permanent` error with a plain reason).
- First comment and post stats should work for Reels on FB and IG through the existing paths (they key off the saved
  IDs); the builder confirms the FB Reel's ID is the right object for comments/insights.
- Telegram handoff and handoff page: by-hand platforms still get the clip; add the cover when present. The handoff
  "Done" cleanup already waits until no automatic platform is pending; it must also delete the cover.
- `publish.yml` `timeout-minutes: 10` is too short for several clips with polling; raise it to fit the polling
  budgets. Runs never overlap (`concurrency` group), so a long run only delays the next one.
- Tests use `httpx.MockTransport` as now; no real API calls. Dry run reports the video path without uploading.

## Calls made by Claude (not decided by the user; check these)
- Waiting for processing happens inside one run, with no new status. A Facebook Reel still processing at the end of
  the budget becomes `failed` for a human check (replaces the 30-minute idea from the conversation).
- **Storage cleanup:** if handoff "Done" was tapped while an automatic platform was still pending, the publisher
  deletes the clip and cover from storage once the row ends `posted` (a store-level step, not in adapters). Handoff
  "Done" keeps deleting immediately when nothing is pending, and also deletes the cover.
- No first comment is attempted on a Facebook Reel that never finished processing; it gets the "add it by hand" note.
- FB Reel cover via the thumbnails call is best-effort only.
- Reels are shared to the Page feed / IG grid.

## Constraints
- Supabase free plan: 50 MB per file, 1 GB total. 2–3 clips a day is 150 MB/day at worst, so cleanup on handoff
  "Done" is what keeps storage in check.
- Meta Reels API: 30 API-published Reels per Page per 24 h (well above 2–3/day). Minimum 540p.
- Meta app is in Development mode; Reels publishing uses the existing `pages_manage_posts` /
  `instagram_content_publish` permissions. Builder confirms no extra permission is needed.
- Never publish for real while developing; one real test post only when the user says so.
- No new dependencies.

## Left to the builder
- Exact polling intervals and budgets per platform (keep the total run under the workflow timeout).
- Exact platform limits (duration, size, aspect) to check in the composer, taken from current docs.
- Whether X needs `media_category` `tweet_video` or `amplify_video` for organic posts (docs disagree).
- How the cover field looks in the composer, following the existing settings-row/sheet pattern.
