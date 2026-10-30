# App screens redesign: five tabs, one job per screen

_2026-10-30. Status: approved (visual direction added at approval)._

## Why
The user finds the web app "compact and heavy": the Queue screen crams about six jobs into one page (explainer
hero, filter tabs, 7-day strip, "things to check", search, one list mixing past/today/future/drafts, Last run,
Accounts), and New post is one long form whose checks and preview fall below the Save button on a phone. On a
phone there are also two stacked bars at the bottom (action bar + menu). The user wants more screens, one per
feature, starting from what they actually do:
- Opening the app: **"what's going out today and anything that needs me."**
- Looking back: **"checking how past posts did and their comments."**

Personal app, one user, used mostly on a phone (PWA), also on desktop.

## Goals
1. Five bottom tabs on phone: **Today · Planned · + New · History · Accounts** (New in the middle as a raised
   button). One bar; it replaces both stacked bars. On desktop the same five become a left sidebar and each screen
   gets the full width.
2. **Today** (home): only what's going out today plus anything that needs the user.
3. **Planned**: upcoming posts by week, and drafts.
4. **History**: past posts with how they did and their comments; a detail page per post.
5. **New post** (also used for editing): write-first layout, settings as one-line rows.
6. **Accounts**: as today, plus the run status.

## Non-goals
- No new data, publisher or schema changes: every screen reads what the app already stores (posts, stats,
  runs, accounts, connections). No new dependencies.
- No charts, totals dashboards or "best time to post" (History is a feed, not analytics).
- No change to how posting, retries, the handoff page or Connect work.
- No new brand: keep the colour tokens, Geist type and the existing stellar motifs; the visual work is the
  material and depth described under "Visual direction".

## Anti-goals (a failure even if it works)
- Losing any existing capability on the way (see "Keep everything that exists").
- Today becoming a dumping ground again: if it needs scrolling past things that aren't "today" or "needs you",
  it has failed.
- Anything that lets a post be edited or deleted while `posting`, or that weakens the existing safety rules
  (`.neq('status','posting')`, zero-row checks, comment lock, Retry only via `canRetry`).
- Problems with a post only visible after scrolling past the Save button.
- Phone layout with horizontal scroll, tap targets under 44px, or a bottom bar covering content.

## Constraints
- Stack stays: Vite + React + TS PWA in `web/`, hash routing (`web/src/route.ts`), Supabase with the publishable
  key only, Realtime updates. No new dependencies without asking.
- Keep mirrors in step (`validation.ts` ↔ `validation.py`, `content.ts` ↔ `Post.text_for`).
- Accessibility as today: labels, focus order, `prefers-reduced-motion`, 44px targets, AA contrast.
- CLAUDE.md rules for web edits/deletes apply unchanged.

## Visual direction: Liquid Glass × stellar (the user's ask)
The user asked for "the liquid glass and stellar design mix" (written "liquid gas"; read as Liquid Glass, Apple's
translucent material — my reading). Meaning:
- **Stellar backdrop** (exists today): the night-sky field with stars, shooting stars, planets/rocks, the paper-
  plane flight path, orbit moons and the constellation. It moves from the per-screen hero cards to a **shared
  app background** behind every screen (subtle in light screens, richer behind Today's header), so screens can
  drop the big hero blocks without losing the character.
- **Liquid Glass surfaces** float over it: the bottom tab bar (a floating, rounded capsule with the raised +),
  bottom sheets/popovers, New post's action bar, Today's "Needs you" card and section headers that stick while
  scrolling. Translucent fill + `backdrop-filter: blur() saturate()`, a thin light rim (inner highlight on the top
  edge), soft shadow, and a gentle specular sheen; content scrolls visibly underneath.
- Content cards (post rows, History cards, comments) stay mostly solid for legibility, with a light glass edge.
- Motion: glass reacts subtly (press scale, sheen shift); everything respects `prefers-reduced-motion` and the
  existing easing tokens. Text on glass must still meet AA contrast (add a stronger fill or scrim where needed);
  a solid fallback where `backdrop-filter` isn't supported or `prefers-reduced-transparency` is set.

## Decided (by the user, from mockups)
### Navigation
- Phone: bottom tab bar, five items, **Today · Planned · (+) · History · Accounts**; (+) is a raised round button
  that opens New post. The current header menu and the separate sticky action bar go away (New post keeps its own
  bottom bar while it's open; see below).
- Desktop: the same five as a left sidebar.

### Today
- Top: a small title ("Today") and the date; no explainer hero.
- **Needs you** first: failed posts (with Retry where `canRetry`), by-hand posts waiting (link to the handoff
  page), posts needing a check. Only shown when there is something.
- **Going out today**: today's posts in time order with platforms and status; posts already out earlier today
  move to the bottom ("Out today"), with their Open links.
- Live updates as now (Realtime), including the current "Going out" behaviour for posts in flight.

### Planned (week strip + selected day)
- The week across the top with a dot on days that have posts; tap a day to show only its posts below, plus
  "+ Add a post on <day>" which opens New post with that day preset.
- Drafts listed underneath.
- Tap a post to open it in New post for editing.

### History (feed with filters)
- Newest first. Each card: picture (or a type tile for text/video), caption (one line), key numbers (views, likes,
  comments) when stats exist, when it went out, and where.
- Filters: **All · Facebook · Instagram · By hand**.
- Tap a post → **post detail**: switch Facebook / Instagram; views, reach, likes, comments, shares; whether the
  first comment went out (or its note: "not added, add it by hand"); top comments (author, text, likes, time);
  buttons **Open on Facebook/Instagram** and **Post again**.

### New post (write first, settings as rows) — also the edit screen
- A big caption box at the top, "+ first comment" just under it (expands to the comment field; locked with its
  note once live, as now).
- Below, one-line rows showing the current choice, each opening a bottom sheet (phone) / popover (desktop) to
  change it: **Media**, **Where** (account(s) and platforms, incl. by-hand ones), **When** (Now / time, with the
  existing quick times), **Link**.
- Problems show as short warnings right under the rows while writing (same messages as today's checks).
- One bottom bar: **Save draft** and **Post now** (reads **Schedule** when a time is set).
- **Preview**: a button at the top on phone opens it; on desktop it stays visible beside the form.
- Per-platform caption/hashtag/title overrides are edited from the preview ("Edit Instagram's version").

### Accounts
- Unchanged, plus a small run-status line ("Last run 16:06 · 1 posted") moved here from the Queue sidebar.

## Keep everything that exists (must survive the move)
Search (moves to History, covering past and upcoming captions); Realtime updates; Retry now; Post again;
multi-account posts (one post to several accounts, grouped); per-platform toggles and previews; per-platform
variants; first comment + its lock; media upload, paste/drop, PNG→JPEG for Instagram; Android share target
(lands in New post with the file); draft autosave and remembered choices; quick times; Ctrl/Cmd+Enter to save;
the 4 pm nudge link (`#/new`); the handoff page (`#/handoff/N`, unchanged, reached from Today's "Needs you");
Connect buttons and account editing; stats line, top comments and comment notes (now in History);
links from Telegram (`#/handoff/N`, `#/new`) and from Connect (`#/accounts?...`) keep working.

## Where each post lives (settled after review)
- **Today, "Needs you"**: every unresolved post regardless of age — `failed`, `missed`, `partial`, stuck
  `posting`, and by-hand posts waiting for the handoff (as the Queue's attention list does today). An old failed
  post stays until the user retries, reschedules or deletes it; that is intentional ("unresolved posts always
  visible"). _(Answered by the existing app.)_
- **Today, "Going out today"**: posts whose `publish_at` falls on today's local calendar day in the account's
  time zone (the Composer already uses it), that are `scheduled` or `posting`, including ones whose time has
  passed but haven't gone out yet; posts `posted` today drop to "Out today" at the bottom. _(My call.)_
- **Planned**: `scheduled` posts after today, plus drafts (`draft`, with or without a time). _(My call.)_
- **History**: `posted` posts only (API and by hand), newest first. Failed/missed posts are not History; they are
  on Today until resolved. _(My call.)_
- **History "By hand" filter**: posts that went out (at least partly) by hand, i.e. sent to the phone; they show
  "by hand · no stats". _(My call.)_
- **Grouping**: a post sent to several accounts is one card (grouped by `group_id`, as the Queue does today); its
  detail page lets you switch account as well as Facebook/Instagram. _(My call.)_
- **History loading and search**: pages of 30, older ones load on scroll; search queries the database across all
  posts (captions, like today's search), not just what's loaded. _(My call.)_
- **Opening a post**: `#/edit/N` on a post that is already `posted` opens its History detail instead (there is
  nothing to edit); after Save, go back to the screen you came from. "+ Add a post on <day>" passes the day to
  New post in the route. _(My call; route names stay the builder's.)_
- **Post again** keeps today's meaning: it opens New post pre-filled from the old post (caption, media,
  accounts/platforms, link; not the time or the first comment's IDs); nothing posts until Save / Post now.
  _(Answered by the existing app.)_
- **Desktop New post**: the right column shows only the preview; checks move under the setting rows on every
  screen size. _(My call.)_
- **Tests**: moved or new logic (day grouping, week strip, Today/Planned/History selection, filters) gets unit
  tests next to the existing ones (`postView.test.ts` etc.); every screen gets a screenshot check at phone and
  desktop width before it's called done. _(My call.)_

## Left to the builder
- Route names for the new screens (keep existing ones working: `#/` → Today, `#/new`, `#/edit/N`,
  `#/handoff/N`, `#/accounts`).
- How much of `Queue.tsx`/`Composer.tsx` is reused vs split into new screen files; shared pieces
  (post row, chips, stats line) become components.
- Exact sheet/popover mechanics, animation (respecting reduced motion), empty states, icons for the tabs.
- How History loads older posts (pagination on scroll is fine) and how far back by default.
- Desktop sidebar width and breakpoints, matching the existing CSS variables.
