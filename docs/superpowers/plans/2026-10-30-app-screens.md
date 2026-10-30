# App Screens Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the crammed Queue + long Composer with five screens (Today, Planned, New post, History, Accounts) behind a bottom tab bar / desktop sidebar, in a Liquid Glass × stellar look.

**Architecture:** Pure selection logic (which post shows where, routes) goes in one tested module; one shared data hook replaces Queue's loading; each screen is its own file; the Composer keeps all its state and save logic and only its render changes to "write first, settings as rows" with a native `<dialog>` bottom sheet. Visual work is CSS: a shared fixed starfield behind every screen and glass surfaces built on the existing `.island` liquid-glass recipe.

**Tech Stack:** Vite + React 19 + TypeScript PWA (`web/`), Supabase JS (publishable key), vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-30-app-screens-redesign-design.md` (read it; its "Where each post lives" section is binding).

## Global Constraints
- No new dependencies; no schema, publisher or Edge Function changes. Only `web/` changes (plus docs).
- Keep CLAUDE.md web rules: edits/deletes `.neq('status','posting')` + zero-row check; first-comment lock; Retry only via `canRetry`; `web/` uses the publishable key only.
- Existing routes keep working: `#/` (now Today), `#/new`, `#/edit/N`, `#/handoff/N` (unchanged screen, no tab bar), `#/accounts` and `#/accounts?connected=…|error=…`.
- Phone: tab bar items exactly **Today · Planned · (+) · History · Accounts**, (+) raised round button → New post. Desktop (≥ 900px): same five as a left sidebar.
- Visual: keep colour tokens and Geist type; stellar backdrop shared behind all screens; glass = translucent fill + `backdrop-filter: blur() saturate()` + light top rim + soft shadow; solid fallback under `@supports not (backdrop-filter: blur(1px))` and `@media (prefers-reduced-transparency: reduce)`; all motion off under `prefers-reduced-motion`; AA contrast on glass; 44px tap targets; no horizontal scroll at 375px.
- Day boundaries use the account time zone: `tz = accounts[0]?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone` (the publisher already treats the first account's zone as "the" zone).
- Commands (from `web/`): `npm test`, `npm run build` (runs `tsc --noEmit`). Visual checks use the mocked-Supabase Playwright setup in `.playwright-mcp/mock.js` with `VITE_SUPABASE_URL=https://mock.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_mock npx vite --port 5179`.

## Review Focus
1. A post at 23:30 Manila time is "today" on a device set to UTC (and vice versa): Today/Planned must follow the account zone, not the device. → Task 1 test `local day follows the account time zone`.
2. A multi-account post where one row failed and another posted: the group shows in Today's "Needs you" **and** in History. → Task 1 tests.
3. Old deep links: `#/handoff/12`, `#/new`, `#/accounts?connected=meta`, `#/edit/12` on a posted post → handoff page, composer, accounts with banner, History detail. → Task 1 `parseRoute` tests + Task 6 redirect.
4. Android share target and draft autosave still land in New post with the shared file / restored text. → Task 6 manual check step.
5. A device without `backdrop-filter` or with reduced transparency still has readable tab bar, sheets and bars. → Task 2 CSS fallback + Task 7 visual check (rendered with the fallback forced).

---

### Task 1: Selection logic and routes (pure, tested)

**Files:**
- Create: `web/src/selectors.ts`, `web/src/selectors.test.ts`

**Interfaces (Produces):**
- `type HistoryFilter = 'all' | 'facebook' | 'instagram' | 'hand'`
- `localDay(iso: string, tz: string): string` → `'YYYY-MM-DD'` (use `utcToZoned` from `time.ts`).
- `isStale(post: Post, now: Date): boolean` → `posting` with `claimed_at` older than 30 min.
- `needsAttention(post: Post, now: Date): boolean` → `failed | missed | partial`, `isStale`, or `awaitingHandoff` (from `postView.ts`).
- `todayView(posts: Post[], now: Date, tz: string): { needsYou: PostGroup[]; goingOut: PostGroup[]; outToday: PostGroup[] }` — groups via `groupPosts`; `needsYou`: groups with any row `needsAttention`, newest first; `goingOut`: groups whose lead `publish_at` is on today (`localDay`) with any row `scheduled`/`posting`, by time; `outToday`: groups posted today (lead `posted_at` today), latest first, excluding groups already in `goingOut`. A group may be in `needsYou` and one other list.
- `weekDays(posts: Post[], start: string, tz: string): { day: string; weekday: string; date: number; count: number }[]` — 7 days from `start` (`'YYYY-MM-DD'`), `count` = scheduled/posting groups that day.
- `plannedDay(posts: Post[], day: string, tz: string): PostGroup[]` — `scheduled`/`posting` groups on `day`, by time.
- `draftGroups(posts: Post[]): PostGroup[]` — groups whose rows are all `draft`, newest `created_at` first.
- `historyGroups(posts: Post[], filter: HistoryFilter, accountOf: (id: number) => Account | undefined): PostGroup[]` — groups with any `posted` row, newest `posted_at` first; `facebook`/`instagram` = a row has that platform done by API; `hand` = a row has a platform `sentByHand`.
- `type Route = { screen: 'today' } | { screen: 'planned'; day?: string } | { screen: 'history' } | { screen: 'post'; num: number } | { screen: 'new'; day?: string } | { screen: 'edit'; num: number } | { screen: 'handoff'; num: number } | { screen: 'accounts' }`
- `parseRoute(parts: string[], query: URLSearchParams): Route` — `''`→today, `planned[?day=]`, `history`, `history/N`→post, `new[?day=]`, `edit/N`, `handoff/N`, `accounts`; unknown → today; bad numbers → today; `day` kept only if it matches `^\d{4}-\d{2}-\d{2}$`.

- [ ] **Step 1: Write failing tests** in `selectors.test.ts` (build posts with a small `post({...})` factory like `postView.test.ts` does):
  - `local day follows the account time zone`: `localDay('2026-10-30T15:30:00Z','Asia/Manila') === '2026-10-30'` and `localDay('2026-10-30T16:30:00Z','Asia/Manila') === '2026-10-31'`.
  - `todayView`: a failed post from last week is in `needsYou`; a `scheduled` post at 09:00 today (time passed) is in `goingOut`; a post `posted` today is in `outToday`; tomorrow's post is in none; a `posting` row claimed 45 min ago is in `needsYou`, claimed 5 min ago is in `goingOut` only.
  - `mixed group`: rows `{group_id:'g', status:'failed'}` + `{group_id:'g', status:'posted'}` → group in `todayView(...).needsYou` and in `historyGroups(..., 'all', ...)`.
  - `weekDays` from `'2026-10-31'`: 7 entries, first `day === '2026-10-31'`, counts only scheduled.
  - `plannedDay` sorted by time; `draftGroups` excludes scheduled.
  - `historyGroups` filters: `'hand'` keeps a `fb_profile` post with `tg_message_id`, `'instagram'` keeps only posts with `ig_media_id`.
  - `parseRoute`: `['']`→today; `['handoff','12']`→`{screen:'handoff',num:12}`; `['history','7']`→post 7; `['new']` with `day=2026-11-02`→`{screen:'new',day:'2026-11-02'}`; `day=nope` dropped; `['edit','x']`→today; `['accounts']`→accounts.
- [ ] **Step 2: Run** `npm test` → new tests FAIL (module missing).
- [ ] **Step 3: Implement** `selectors.ts` with the signatures above, reusing `groupPosts`, `awaitingHandoff`, `sentByHand`, `isDone`, `utcToZoned`.
- [ ] **Step 4: Run** `npm test && npm run build` → PASS.
- [ ] **Step 5: Commit** `web: selection logic and routes for the new screens`.

### Task 2: App shell — tab bar, sidebar, routes, Liquid Glass × stellar foundation

**Files:**
- Create: `web/src/Nav.tsx`
- Modify: `web/src/App.tsx`, `web/src/route.ts`, `web/src/styles.css`, `web/src/icons.tsx` (tab icons)

**Interfaces:**
- Consumes: `parseRoute`, `Route` (Task 1).
- Produces: `Nav({ current }: { current: Route['screen'] })` rendering one `<nav aria-label="Main">` (phone: fixed bottom floating glass capsule; desktop ≥ 900px: fixed left sidebar, via CSS only); `rememberTab(path: string): void` and `lastTab(): string` in `route.ts` (sessionStorage `pp-last-tab`, default `'/'`, wrapped in try/catch); CSS classes `.glass` (surface recipe) and `.app` (layout with sidebar offset / bottom padding for the bar).
- App renders: `handoff` → `<Handoff>` alone (as now); `new`/`edit` → Composer **without** the phone tab bar (sidebar stays on desktop); every other screen → screen + `<Nav>`. Until Tasks 3–5 land, `today` renders the existing `<Queue />`, `planned`/`history`/`post` render a placeholder `<p>Coming soon</p>` (replaced in later tasks). `rememberTab` is called for today/planned/history/accounts.
- Sign out moves out of the nav into Accounts (Task 7); until then keep `SignOut` rendered at the end of the sidebar/top of Accounts so it is never unreachable.

- [ ] **Step 1: Starfield behind every screen.** Move the night-sky layers that `.sky` draws (aurora `::before`, stars/grain `::after`, parallax vars) into a fixed full-viewport `.starfield` layer rendered once in `App` (`<div className="starfield" aria-hidden="true">` with `<FlightPath />` and `<Asteroids />`), dark at the top fading to `--ground` by ~40vh on light screens; keep `.sky` working for screens not yet migrated. Respect `prefers-reduced-motion` (existing rules).
- [ ] **Step 2: Glass recipe.** Generalise the existing `.island` liquid-glass (`backdrop-filter: url(#lg-refract)` layer + blur/saturate layer, inset top rim) into `.glass` with tokens `--glass-fill`, `--glass-rim`, `--glass-blur`; add fallbacks: `@supports not (backdrop-filter: blur(1px))` and `@media (prefers-reduced-transparency: reduce)` → solid `--card` fill, no blur.
- [ ] **Step 3: Nav.** Five links with icon + label (`Today`, `Planned`, `New post` as the raised round (+) with `aria-label="New post"`, `History`, `Accounts`), `aria-current="page"` on the active one, ≥ 44px targets, safe-area bottom inset; press scale 0.97 (reduced-motion: none).
- [ ] **Step 4: Wire App** to `parseRoute(useRoute(), new URLSearchParams(location.hash.split('?')[1] ?? ''))`; remove the old `.island` header nav markup.
- [ ] **Step 5: Run** `npm test && npm run build` → PASS. Start the mocked dev server and screenshot `#/` at 390×844 and 1366×900: tab bar floats over the starfield, sidebar on desktop, no horizontal scroll.
- [ ] **Step 6: Commit** `web: bottom tab bar / sidebar and Liquid Glass x stellar foundation`.

### Task 3: Today screen + shared data hook

**Files:**
- Create: `web/src/usePosts.ts`, `web/src/screens/Today.tsx`, `web/src/PostRow.tsx`
- Modify: `web/src/App.tsx` (route `today` → `<Today />`), `web/src/styles.css`

**Interfaces:**
- Produces `usePosts(): { posts: Post[]; accounts: Account[]; run: Run | null; error: string; loaded: boolean; reload: () => void }` — moved from `Queue.tsx`'s `load` + Realtime + visibility effect, **same queries** (last 2 days onward + undated, unresolved of any age, handoffs waiting).
- Produces `PostRow({ group, accountOf, tz, href? }: { group: PostGroup; accountOf: (id: number) => Account | undefined; tz: string; href?: string })` — time, thumbnail/type tile, caption (2 lines), chips per row (with account name when multi-account), status pill, Open links; default `href` = `groupHref(group.rows)`.
- Today: small title "Today" + date (account tz), no explainer hero. **Needs you** glass card (only when non-empty): each item shows the post, its `last_error` and **Retry now** where `canRetry` (reuse `retryNow` + busy state as Queue does), or **Post it now** linking to `#/handoff/N` for by-hand items. **Going out today** list (`PostRow`), then **Out today** list. Empty state: constellation + "Nothing going out today." + link to New post. The existing "Going out" in-flight step text (`flightStep`) is shown on rows that are `posting`.

- [ ] **Step 1: Write failing test** in `selectors.test.ts` only if Today needs new pure logic (e.g. a `flightStep` move to `postView.ts`: test its existing outputs there). Otherwise this task's logic is Task 1's.
- [ ] **Step 2: Implement** `usePosts`, `PostRow`, `Today`; route it.
- [ ] **Step 3: Run** `npm test && npm run build` → PASS.
- [ ] **Step 4: Visual check** (mocked data) at 390 and 1366: Today opens on Needs you then today's posts; nothing else on the screen; tab bar does not cover the last row.
- [ ] **Step 5: Commit** `web: Today screen (needs you + going out today)`.

### Task 4: Planned screen

**Files:**
- Create: `web/src/screens/Planned.tsx`
- Modify: `web/src/App.tsx`, `web/src/styles.css`

**Interfaces:** Consumes `usePosts`, `PostRow`, `weekDays`, `plannedDay`, `draftGroups`, `localDay`.
- Week strip starts tomorrow (`localDay(now + 1 day)`), 7 days, dot on days with `count > 0`, selected day highlighted (`aria-pressed`), prev/next week buttons (and horizontal swipe on touch is optional). Selected day from route `#/planned?day=` (default: first day with posts this week, else tomorrow); selecting writes the route with `history.replaceState`.
- Below: that day's `PostRow`s, then **+ Add a post on <weekday>** → `#/new?day=YYYY-MM-DD`. Then **Drafts** (count) with `PostRow`s linking to `#/edit/N`.

- [ ] **Step 1: Implement** Planned; route `planned`.
- [ ] **Step 2: Run** `npm test && npm run build` → PASS.
- [ ] **Step 3: Visual check** at 390 and 1366 (week strip fits 375px without horizontal page scroll).
- [ ] **Step 4: Commit** `web: Planned screen (week strip + selected day + drafts)`.

### Task 5: History feed and post detail

**Files:**
- Create: `web/src/screens/History.tsx`, `web/src/screens/PostDetail.tsx`
- Modify: `web/src/App.tsx`, `web/src/styles.css`, `web/src/postView.ts` (only if a helper moves)

**Interfaces:** Consumes `historyGroups`, `HistoryFilter`, `statsLine`, `ago`, `compact`, `postLinks`, `usePosts().accounts`.
- History loads its own data: `posts` where `status = 'posted'`, `order('posted_at', desc)`, `.range()` pages of **30**; "Load more" button + IntersectionObserver auto-load; search box (300 ms debounce) runs `ilike('caption', %q%)` across all statuses (as Queue's search does today, escaping `%_\`), showing results grouped the same way (non-posted results open `#/edit/N`).
- Filters: **All · Facebook · Instagram · By hand** (`historyGroups`).
- Card: picture or type tile, one-line caption, `statsLine` of the best platform (FB if present, else IG) or `By hand · no stats`, "when · where" line; tap → `#/history/<lead num>`.
- PostDetail (`num`): loads the group (by `group_id` if set), account switcher when several rows, platform switcher (Facebook / Instagram) showing views, reach, likes, comments, shares (missing = "—"), "as of …", first comment status (`fb_comment_id`/`ig_comment_id`: real id → "First comment posted"; `not-added` → "First comment not added — add it by hand"; `unclear` → "First comment may not have been added — check"; empty with `first_comment` → "No first comment"), top comments (author, text, ♥ likes, `ago`), `last_error` note, buttons **Open on Facebook/Instagram** (`postLinks`) and **Post again** (→ the Composer's existing post-again behaviour: open `#/edit/N` and trigger it, or move `postAgain` into a shared helper `startPostAgain(rows: Post[]): void` in `actions.ts` that calls `saveDraft` exactly as Composer does and goes to `#/new`).
- Comment text renders as text only.

- [ ] **Step 1: Write failing test** for `startPostAgain` if extracted (in a new `actions.test.ts`: it saves a draft with caption/variants/link/targets/media and no time, `mode: 'now'`, and drops removed media with the existing note) — mock `saveDraft`/`go`.
- [ ] **Step 2: Implement** History, PostDetail, routes `history` and `history/N`.
- [ ] **Step 3: Run** `npm test && npm run build` → PASS.
- [ ] **Step 4: Visual check** at 390 and 1366 with the mocked stats post (top comments wrap; filters fit).
- [ ] **Step 5: Commit** `web: History feed with filters and post detail`.

### Task 6: New post — write first, settings as rows

**Files:**
- Create: `web/src/Sheet.tsx`, `web/src/composer/SettingRow.tsx`
- Modify: `web/src/screens/Composer.tsx`, `web/src/App.tsx` (pass `day`), `web/src/styles.css`

**Interfaces:**
- `Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode })` — native `<dialog>` with `showModal()`, glass surface, bottom sheet on phone / centred popover ≥ 900px, closes on Esc/backdrop/close button, returns focus to the opener, `aria-labelledby` title.
- `SettingRow({ icon, label, value, warning, onOpen }: { icon: ReactNode; label: string; value: string; warning?: string; onOpen: () => void })` — a full-width ≥ 44px button "label … value ›"; `warning` renders under it (role="alert" only when newly shown via existing touched/tried logic).
- `Composer({ num, day }: { num?: number; day?: string })`. **All existing state, effects and functions stay** (`save`, `upload`, `toggle`, `toggleHand`, `postAgain`, `remove`, validation, autosave, share-target pickup, Ctrl/Cmd+Enter); only the JSX changes:
  - Top bar: ✕ close (→ `lastTab()`), title "New post" / "Edit post", **Preview** button (phone; opens a Sheet with `PostPreview` + the per-platform `PlatformText` editors).
  - Big caption textarea, then "+ First comment" that expands the existing first-comment field (locked note unchanged).
  - Rows (each opens a Sheet with the **existing** controls for that section): **Media** (`None` / `Photo` / `Video` / `Uploading…`), **Where** (`<account> · FB, IG` or `<n> accounts · …`; sheet holds account targets + "To your phone" toggles), **When** (`Now` or the local time like `Mon 2 Nov, 18:36`; sheet holds Post now/Schedule, quick times, datetime input), **Link** (`—` or hostname).
  - Warnings: `bySection(problems)` → caption messages under the caption, `media`/`where`/`when` messages under their rows (same message text as today).
  - Bottom glass bar: **Save draft** and **Post now** (label **Schedule** when mode is later); edit mode keeps the existing Delete and Post again actions in the bar's overflow (a "More" button opening a small Sheet).
  - Desktop ≥ 1024px: preview column on the right (only the preview; no checks/plan panels).
  - `day` prop (from `#/new?day=`): when set and no restored draft, start in Schedule mode with `publishAt = ${day}T09:00`.
  - Editing a `posted` row (`num` given and every loaded row `posted`): `go('/history/' + num)` instead of showing the form.
  - After a successful save: `go(lastTab())`.

- [ ] **Step 1: Write failing tests** for the pure summaries, in `composer/summary.ts` + `summary.test.ts`: `whereSummary(targets, accounts)` (`'fb · FB, IG'`, `'2 accounts · FB, IG, Profile'`, `'Nowhere yet'`), `whenSummary(mode, publishAt, tz)` (`'Now'`, `'Mon 2 Nov, 18:36'`), `linkSummary(link)` (`'—'`, `'shop.example.com'`, invalid → the raw text cut to 24 chars).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `summary.ts`, `Sheet`, `SettingRow`, the new Composer render, `day` and the posted redirect.
- [ ] **Step 4: Run** `npm test && npm run build` → PASS.
- [ ] **Step 5: Manual checks** (mocked dev server): new post with a draft restored; `#/new?day=2026-11-02` starts scheduled; `#/edit/11` (posted) lands on History detail; an Instagram-without-image warning shows under Media while typing; Esc closes a sheet and focus returns to its row; the share target still opens New post with the file (simulate by putting a file in the `SHARE_CACHE` cache as `share.ts` reads it, or note as not verifiable and say so).
- [ ] **Step 6: Visual check** at 390 and 1366 (bottom bar never covers the last row; preview column on desktop).
- [ ] **Step 7: Commit** `web: New post as write-first with settings rows and sheets`.

### Task 7: Accounts, cleanup, final check

**Files:**
- Modify: `web/src/screens/Accounts.tsx`, `web/src/App.tsx`, `web/src/styles.css`, `PROGRESS.md`
- Delete: `web/src/screens/Queue.tsx` (and CSS used only by it: `.filters`, `.week`, hero/queue-only rules), any now-unused helpers (check with `tsc` + grep).

- [ ] **Step 1: Accounts:** drop the big hero for a small title; add the run-status line `Last run 16:06 · 1 posted · 0 failed` (from `usePosts().run`, "No runs yet" when null) and the `SignOut` button (moved from App, same two-tap behaviour).
- [ ] **Step 2: Remove** `Queue.tsx` and dead CSS/helpers; `npm test && npm run build` → PASS with no unused-symbol errors.
- [ ] **Step 3: Full visual check** (mocked data) of Today, Planned, History, Post detail, New post (with a sheet open), Accounts, Handoff and Sign in at 390×844 and 1366×900; plus Today and New post with the glass fallback forced (temporarily add `class="no-glass"` hook or emulate by toggling the fallback rule in DevTools via `browser_evaluate` adding a style that applies the fallback) — text readable, nothing covered, no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`).
- [ ] **Step 4: PROGRESS.md:** a short "Screens redesign" entry (five tabs, what moved where).
- [ ] **Step 5: Commit** `web: Accounts run status, remove old Queue, progress note`.
