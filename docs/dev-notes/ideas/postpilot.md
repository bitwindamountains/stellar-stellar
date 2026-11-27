# PostPilot (personal edition)

## Problem Statement
How might we cut my daily posting to five platforms (FB profile, FB Pages, IG, TikTok, YT) down to planning in one Sheet, with everything the APIs allow published automatically and everything else handed to me ready to post in one tap?

## Recommended Direction
Build the blueprint's core trimmed down for one user: a Google Sheet, run by GitHub Actions every 30 minutes, publishing text, link and image posts to my FB Pages and IG. Run the Meta app in dev mode with a System User token, so no App Review is needed.

Add a **Telegram assist** next. Rows marked for platforms that can't be automated (FB profile, TikTok, YT) arrive in Telegram at post time with the media and caption, so posting takes about 30 seconds. All five platforms are covered from week one without waiting on any audit.

Then add the two big multipliers: **feed autopilot**, which turns my YouTube and blog items into FB/IG rows, and **video fan-out**, which publishes one clip as FB Reel and IG Reel through the API and sends it to TikTok and YT through the assist. TikTok and YouTube API audits run in the background. If they pass, those platforms move from "assisted" to "automatic" without changing the Sheet.

## Platform Reality (verify against current docs)
| Platform | Auto-post? | Catch |
|---|---|---|
| FB personal profile | No | API posting to personal profiles was removed |
| FB Pages | Yes | Covered by the blueprint |
| Instagram | Yes | Professional account linked to a Page |
| TikTok | Partly | Until the app passes audit, API posts are private (only you can see them) |
| YouTube | Partly | Until the API project passes audit, uploads are locked private; quota allows ~6 uploads/day |

## Key Assumptions to Validate
- [ ] **Uploading is the chore, not creating.** Log minutes spent creating versus uploading for one week before coding.
- [ ] **I'll actually plan in a Sheet.** Hand-plan next week's posts in a Sheet with the blueprint's columns. If I skip it, rethink before building.
- [ ] **A dev-mode Meta app can post to my Pages and IG.** Make one Graph API Explorer test post to my Page and IG on day 1.
- [ ] **The free media hosting tier covers my video volume.** Check Cloudinary or Supabase limits against a week of real clips.
- [ ] **Telegram assist gets used, not ignored.** Run it for one week and count posts I actually made from it.

## MVP Scope
**In:** Sheet with `init-sheet`, `validate` and `publish` (with `--dry-run`); FB Page text/link/photo; IG single image; per-platform ID write-back (no double posts); GitHub Actions cron; Telegram assist for rows that target `fb_profile`, `tiktok` or `youtube`.

**Next (in order):** feed autopilot → FB and IG Reels plus video via a media host → TikTok/YT audit applications.

**Out of MVP:** everything below.

## Not Doing (and Why)
- **Approvals column and protected ranges.** I'm the only approver.
- **Multi-client Accounts and "Bea" workflows.** Wait until someone pays.
- **Full stale-post reconciliation.** One user and a concurrency lock keep the risk small. Keep only the ID-presence check.
- **Insights tab and summary email.** GitHub failure emails are enough for me.
- **Meta App Review and business verification.** Only needed when selling.
- **API posting to my personal FB profile.** It isn't possible, so the assist covers it permanently.
- **AI captions and evergreen recycling.** These are vitamins, not painkillers.

## Open Questions
- Which media host: Cloudinary, Supabase or R2? Decide after checking real clip sizes.
- Should the Telegram bot also accept "done" replies, so the Sheet marks assisted posts as posted?
- Is "sellable later" a real goal? If so, set a trigger, such as 3 people asking, before multi-account work starts.
