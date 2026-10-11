# PostPilot: usability round 1

## Problem Statement
How might we make posting one item a day to five platforms take under a minute (each platform with its own
wording) and make it impossible to quietly miss a day?

## Recommended Direction
Write one post with a base caption and optional per-platform overrides: a YouTube title, per-platform hashtags,
and a Facebook link line. Choose **Post now** (out in about a minute) or **Schedule**, with quick time chips.
The composer remembers your last choices, accepts pasted or dragged-in media on PC, and accepts shares from your
Android gallery. The Queue shows a 7-day strip, and Telegram nudges you at 4 pm if today is empty.

## Key Assumptions to Validate
- [ ] Go-live works end to end: one real post to FB, IG and the Telegram handoff. Test it before building more.
- [ ] A triggered GitHub run starts within about 2 minutes. Measure 5 runs after the repo is pushed.
- [ ] Most posts need overrides on at most 1–2 platforms. Check after 2 weeks of use.
- [ ] Sharing from your Android gallery into the installed app gets used. Watch whether you start posts from the phone.

## MVP Scope
**In:**
1. Per-platform content: a `variants` field holding caption, hashtags and title per platform. The publisher,
   the checks, Telegram and the handoff all use it. YouTube title limit 100.
2. Post now / Schedule toggle, with time chips (In 1 hr · Tonight 7 pm · Tomorrow 9 am). Post now triggers the
   publisher via a Supabase function.
3. Sticky defaults: last account, plus last platforms per media type.
4. Android share target: the installed app appears in your gallery's Share menu.
5. 7-day strip on the Queue, and a Telegram nudge at 4 pm on empty days.
6. Quality of life: draft autosave in the browser; paste or drag media in on PC; Ctrl+Enter to post or
   schedule; "Post again" (duplicate); one-tap Retry or Reschedule on failed posts; "Open post" links on posted rows.

**Out:** everything below.

## Not Doing (and Why)
- Insights / "know what worked": needs extra Meta permissions and weeks of data, and only covers FB and IG.
- AI caption help: costs money and adds a server-side key. Per-platform overrides cover most of the need.
- Calendar view: you post daily, one at a time, so the 7-day strip is the calendar you need.
- Carousels and FB/IG video: the publisher doesn't support them yet. Separate work.
- Configurable nudge time UI: a fixed hour (an environment setting) until it annoys you.

## Open Questions
- Is the repo going to GitHub soon? Post now can't trigger a run without it (it still posts at the next run).
- What nudge hour do you want? 4 pm is a guess.
- Which hashtags do you mostly use per platform? They would seed the defaults.
