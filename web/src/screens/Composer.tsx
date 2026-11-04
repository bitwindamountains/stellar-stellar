import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { cleanVariants, isCustomized, textFor, type Variant, type Variants } from '../content'
import { Arrow, Asteroids, Check, Close, Eye, FlightPath, LinkIcon, MediaIcon, More, WhenIcon, WhereIcon } from '../icons'
import { publishSoon } from '../actions'
import { postLinks } from '../groups'
import { toJpeg, videoSeconds } from '../media'
import { mediaWasRemoved } from '../postView'
import PostPreview from '../PostPreview'
import Sheet from '../Sheet'
import SettingRow, { FieldError } from '../composer/SettingRow'
import { initialWhen, linkSummary, whenSummary, whereSummary } from '../composer/summary'
import { takeShared } from '../share'
import { draftTargets, loadDraft, rememberChoices, rememberedTargets, saveDraft, type Targets } from '../prefs'
import { go, lastTab, takeQuery } from '../route'
import { bySection, SECTIONS, type Section } from '../fields'
import { supabase } from '../supabase'
import { quickTimes, utcToZoned, zonedToUtc } from '../time'
import { ACCOUNT_SELECT, canPost, isConnected, isDone, postedByApi, PLATFORM_NAMES, PLATFORMS, type Account, type MediaType, type Platform, type Post } from '../types'
import { hashtagCount, IG_CAPTION_MAX, validate, YOUTUBE_TITLE_MAX } from '../validation'

const ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime'
const MAX_BYTES = 50 * 1024 * 1024 // matches the bucket's file_size_limit
const PUBLISHING_NOW = 'This post is being published right now. Try again in a minute, after the run finishes.'
const NAMED = { facebook: 'Facebook', instagram: 'Instagram', x: 'X', tiktok: 'TikTok' } as Record<Platform, string>

// Posted by hand from your phone; TikTok joins them for accounts without a TikTok login.
const HAND: Platform[] = ['fb_profile', 'tiktok', 'youtube', 'shopee']
const isHandPlatform = (p: Platform) => p !== 'tiktok' && HAND.includes(p)

/** A platform this account posts to through its own login. */
function ownLogin(p: Platform, a: Account): boolean {
  return p === 'tiktok' ? isConnected(a, 'tiktok') : !isHandPlatform(p) && canPost(p, a)
}

/** Accounts that have platforms picked, in the order the accounts list shows them. */
function activeIn(accounts: Account[], targets: Targets): Account[] {
  return accounts.filter((a) => targets[a.id]?.length)
}

/** Each account's problems; a problem every account shares is shown once, others name their accounts. */
function problemsFor(active: Account[], targets: Targets, base: Omit<Parameters<typeof validate>[0], 'account' | 'platforms'>, requireTime: boolean): string[] {
  if (active.length === 0) return ['Pick at least one platform']
  const byMessage = new Map<string, string[]>()
  for (const a of active) {
    for (const m of validate({ ...base, account: a, platforms: targets[a.id] }, requireTime)) byMessage.set(m, [...(byMessage.get(m) ?? []), a.name])
  }
  return [...byMessage].map(([m, names]) => (active.length === 1 || names.length === active.length ? m : `${names.join(', ')}: ${m}`))
}

type SheetName = '' | 'media' | 'cover' | 'where' | 'when' | 'link' | 'preview' | 'more'

/** Wide screens keep the preview beside the form; narrow ones open it in a sheet. */
function useWide(): boolean {
  const query = '(min-width: 1024px)'
  const [wide, setWide] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const m = matchMedia(query)
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return wide
}

export default function Composer({ num, day }: { num?: number; day?: string }) {
  const [restored] = useState(() => (num ? null : loadDraft()))
  const hasDraft = !!restored && !!(restored.caption || restored.mediaUrl)
  // Opened from a day on Planned ("Add a post on …"): 9 am that day, even over a restored draft.
  // Kept from the first render: the ?day= is stripped below, so a later App render passes no day.
  const [fromDay] = useState(num ? undefined : day)
  const [start] = useState(() => initialWhen(fromDay, restored))
  const [accounts, setAccounts] = useState<Account[] | null>(null) // null = still loading
  const [rows, setRows] = useState<Post[]>([]) // the stored rows when editing (several for a multi-account post)
  const [targets, setTargets] = useState<Targets>({})
  const [publishAt, setPublishAt] = useState(start.publishAt)
  // Daily posting is the common case, so new posts default to going out now.
  const [mode, setMode] = useState<'now' | 'later'>(start.mode)
  const [sheet, setSheet] = useState<SheetName>('')
  const [commentOpen, setCommentOpen] = useState(false)
  const wide = useWide()
  const [caption, setCaption] = useState(restored?.caption ?? '')
  const [firstComment, setFirstComment] = useState(restored?.firstComment ?? '')
  const [variants, setVariants] = useState<Variants>(restored?.variants ?? {})
  const [tab, setTab] = useState<'all' | Platform>('all')
  const [mediaType, setMediaType] = useState<MediaType>(restored?.mediaType ?? 'none')
  const [mediaUrl, setMediaUrl] = useState(restored?.mediaUrl ?? '')
  const [coverUrl, setCoverUrl] = useState(restored?.coverUrl ?? '')
  const [seconds, setSeconds] = useState<number | null>(restored?.videoSeconds ?? null) // null = unknown: no length check
  const [link, setLink] = useState(restored?.link ?? '')
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState<'' | 'upload' | 'cover' | 'save'>('')
  const [error, setError] = useState('')
  const [tried, setTried] = useState(false)
  const [touched, setTouched] = useState<Section[]>([]) // sections left once: their errors show from then on

  useEffect(() => {
    supabase.from('accounts').select(ACCOUNT_SELECT).order('name').then(({ data, error }) => {
      if (error) {
        setAccounts([]) // leave the loading state so the error is shown instead of a blank screen
        return setError(`Couldn't load your accounts: ${error.message}. Reload to try again.`)
      }
      const list = (data as Account[]) ?? []
      setAccounts(list)
      if (num || !list.length) return
      // Last draft, else last choices for posts without media; only accounts that still exist.
      const wanted = (restored && draftTargets(restored)) ?? rememberedTargets(restored?.mediaType ?? 'none')
      const kept = Object.fromEntries(Object.entries(wanted ?? {}).filter(([id]) => list.some((a) => a.id === Number(id))))
      setTargets(Object.keys(kept).length ? kept : { [list[0].id]: (['facebook', 'instagram'] as Platform[]).filter((p) => canPost(p, list[0])) })
    })
  }, [num])

  useEffect(() => {
    if (!num || !accounts?.length) return
    ;(async () => {
      const one = await supabase.from('posts').select('*').eq('num', num).single()
      if (one.error) return setError(one.error.message)
      const first = one.data as Post
      const all = first.group_id ? await supabase.from('posts').select('*').eq('group_id', first.group_id).order('num') : null
      if (all?.error) return setError(all.error.message)
      const list = (all?.data as Post[] | undefined) ?? [first]
      // Nothing left to change on a post that went out everywhere: show how it did instead.
      // Replace, not push: Back from the detail must not land here and bounce forward again.
      if (list.every((r) => r.status === 'posted')) return location.replace(`#/history/${num}`)
      const lead = list[0]
      const tz = accounts.find((a) => a.id === lead.account_id)?.timezone ?? 'Asia/Manila'
      setRows(list)
      setTargets(Object.fromEntries(list.map((r) => [r.account_id, r.platforms])))
      setPublishAt(lead.publish_at ? utcToZoned(lead.publish_at, tz) : '')
      setMode(lead.publish_at && new Date(lead.publish_at) > new Date() ? 'later' : 'now')
      setCaption(lead.caption)
      setFirstComment(lead.first_comment ?? '')
      setVariants((lead.variants as Variants) ?? {})
      setMediaType(lead.media_type)
      setMediaUrl(lead.media_urls[0] ?? '')
      setCoverUrl(lead.cover_url ?? '')
      setLink(lead.link)
    })()
  }, [num, accounts])

  useEffect(() => {
    if (num) return
    saveDraft({ targets, caption, firstComment, variants, mediaType, mediaUrl, coverUrl, videoSeconds: seconds, link, mode, publishAt })
  }, [num, targets, caption, firstComment, variants, mediaType, mediaUrl, coverUrl, seconds, link, mode, publishAt])

  useEffect(() => {
    if (num) return
    // The ?day= is already applied: drop it so a reload restores the draft as you left it.
    takeQuery()
    // Opened from the Android share sheet: attach the shared file and text once.
    if (!window.location.hash.endsWith('/shared')) return
    takeShared().then((shared) => {
      go('/new')
      if (!shared) return
      if (shared.text) setCaption((current) => current || shared.text)
      if (shared.file) upload(shared.file)
    })
  }, []) // once, on open

  const active = activeIn(accounts ?? [], targets)
  const lead = active[0] // its time zone sets the time for every account
  const tz = lead?.timezone ?? accounts?.[0]?.timezone ?? 'Asia/Manila'
  const chosen = PLATFORMS.filter((p) => active.some((a) => targets[a.id].includes(p)))
  const base = { publishAt, caption, firstComment, variants, mediaType, mediaUrls: mediaUrl ? [mediaUrl] : [], link, coverUrl, videoSeconds: seconds }
  const editing = tab !== 'all' && chosen.includes(tab) ? tab : 'all' // a deselected platform's tab falls back
  const problems = problemsFor(active, targets, base, mode === 'later')
  const locked = rows.some((r) => r.status === 'posting')
  // Once live, the comment can't be added from here (the publisher only posts it with the post).
  const commentLocked = rows.some((r) => r.fb_post_id || r.ig_media_id)
  const rowOf = (id: number) => rows.find((r) => r.account_id === id)
  const errors = bySection(problems)
  // Errors show once a section has been left (or after a blocked save), not while you're still filling it in.
  const shown = (s: Section) => (tried || touched.includes(s) ? errors[s] : [])
  const touch = (s: Section) => (e: React.FocusEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return // still inside the section
    setTouched((t) => (t.includes(s) ? t : [...t, s]))
  }
  const invalid = (s: Section) => (shown(s).length ? { 'aria-invalid': true, 'aria-describedby': `err-${s}` } : {})
  // Closing a section's sheet counts as leaving it.
  const closeSheet = (s: SheetName) => () => {
    if ((SECTIONS as readonly string[]).includes(s)) setTouched((t) => (t.includes(s as Section) ? t : [...t, s as Section]))
    setSheet((cur) => (cur === s ? '' : cur))
  }

  function setVariant(p: Platform, key: keyof Variant, value: string) {
    setVariants((cur) => ({ ...cur, [p]: { ...cur[p], [key]: value } }))
  }

  function toggle(id: number, p: Platform) {
    setTargets((cur) => {
      const list = cur[id] ?? []
      return { ...cur, [id]: list.includes(p) ? list.filter((x) => x !== p) : [...list, p] }
    })
  }

  // By-hand platforms ride on one account's row (the first one picked, else the first account): it only sets the
  // time zone and which phone message they go out in.
  const byHandOn = (id: number, p: Platform) => {
    const a = accounts?.find((x) => x.id === id)
    return !!targets[id]?.includes(p) && (!a || !ownLogin(p, a))
  }
  const handOn = HAND.filter((p) => Object.keys(targets).some((id) => byHandOn(Number(id), p)))
  const handPlatforms = HAND.filter((p) => p !== 'tiktok' || !(accounts ?? []).some((a) => isConnected(a, 'tiktok')) || handOn.includes(p))
  function toggleHand(p: Platform) {
    if (handOn.includes(p)) {
      setTargets((cur) => Object.fromEntries(Object.entries(cur).map(([id, list]) => [id, byHandOn(Number(id), p) ? list.filter((x) => x !== p) : list])))
      return
    }
    const host = activeIn(accounts ?? [], targets)[0] ?? accounts?.[0]
    if (host) toggle(host.id, p)
  }

  async function upload(file: File) {
    setBusy('upload') // lock saving now: converting a big image can take a moment
    setError('')
    // A new post switches to the targets remembered for this media type, so decide with those.
    const kind = file.type.startsWith('video/') ? 'video' : 'image'
    const remembered = num ? undefined : rememberedTargets(kind)
    // Only Instagram needs JPEG; other platforms keep the original (and its transparency).
    if (Object.values(remembered ?? targets).some((list) => list.includes('instagram'))) file = await toJpeg(file)
    const length = kind === 'video' ? await videoSeconds(file) : null
    const url = await put(file)
    if (!url) return
    setMediaUrl(url)
    setMediaType(kind)
    setSeconds(length)
    if (kind !== 'video') setCoverUrl('') // a cover only goes with a video
    if (remembered) setTargets(remembered)
  }

  // Covers go to Instagram as-is, so they are always JPEG.
  async function uploadCover(file: File) {
    setBusy('cover')
    setError('')
    const url = await put(await toJpeg(file))
    if (url) setCoverUrl(url)
  }

  /** Uploads to the media bucket; the public URL, or null with the error shown. Clears `busy` either way. */
  async function put(file: File): Promise<string | null> {
    if (file.size > MAX_BYTES) {
      setBusy('')
      setError('Files over 50 MB are too big for the free plan; shrink it first')
      return null
    }
    const { data: auth } = await supabase.auth.getUser()
    const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
    // Random name in the user's own folder: storage policies only allow that folder.
    const path = `${auth.user?.id}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from('media').upload(path, file, { contentType: file.type })
    setBusy('')
    if (error) {
      setError(error.message)
      return null
    }
    return supabase.storage.from('media').getPublicUrl(path).data.publicUrl
  }

  async function save(status: 'draft' | 'scheduled') {
    if (busy || !accounts) return // Ctrl+Enter skips the disabled buttons; never save mid-upload or twice
    setTried(true)
    const blocked = problemsFor(active, targets, base, status === 'scheduled' && mode === 'later')
    if (blocked.length || !lead) {
      // Move focus to the first section with a problem; its message is right under it.
      // A sheet open (Enter in its field) makes the page inert: close it first, then focus.
      flushSync(() => setSheet(''))
      const first = SECTIONS.find((s) => bySection(blocked)[s].length)
      const target = first && document.querySelector<HTMLElement>(FOCUS[first])
      target?.focus()
      return
    }
    setBusy('save')
    const shared = {
      publish_at: status === 'scheduled' && mode === 'now' ? new Date().toISOString()
        : publishAt ? zonedToUtc(publishAt, tz) : null,
      caption,
      ...(commentLocked ? {} : { first_comment: firstComment.trim() }),
      media_type: mediaType,
      media_urls: mediaUrl ? [mediaUrl] : [],
      cover_url: coverUrl,
      link,
      status,
      // Rescheduling starts a fresh retry budget; filled platform IDs still stop any repost.
      ...(status === 'scheduled' ? { attempts: 0, last_error: '', claimed_at: null } : {}),
    }
    const group_id = rows[0]?.group_id ?? (active.length > 1 || rows.length > 1 ? crypto.randomUUID() : null)
    const fieldsFor = (a: Account) => ({ ...shared, account_id: a.id, platforms: targets[a.id], variants: cleanVariants(variants, targets[a.id]), group_id })
    const failures: string[] = []
    let conflict = false
    // Never change or delete a row the publisher has claimed; .select() reveals a zero-row write so it isn't silent.
    for (const r of rows) {
      const a = active.find((x) => x.id === r.account_id)
      // An account left without platforms has nothing posted (posted platforms can't be unticked): drop its row.
      const { data, error } = a
        ? await supabase.from('posts').update(fieldsFor(a)).eq('num', r.num).neq('status', 'posting').select('num')
        : await supabase.from('posts').delete().eq('num', r.num).neq('status', 'posting').select('num')
      if (error) failures.push(error.message)
      else if (data.length === 0) conflict = true
    }
    const added = active.filter((a) => !rowOf(a.id))
    if (added.length) {
      // New rows always get the comment: the lock only protects rows that are already live.
      const { error } = await supabase.from('posts').insert(added.map((a) => ({ ...fieldsFor(a), first_comment: firstComment.trim() })))
      if (error) failures.push(error.message)
    }
    const ok = !failures.length && !conflict
    if (ok && status === 'scheduled' && mode === 'now') await publishSoon()
    setBusy('')
    // Enter in a sheet's field submits too: close it, so the error isn't behind an inert page.
    if (failures.length || conflict) setSheet('')
    if (failures.length) return setError(failures.join(' · '))
    if (conflict) return setError(PUBLISHING_NOW)
    rememberChoices(mediaType, Object.fromEntries(active.map((a) => [a.id, targets[a.id]])))
    if (!num) saveDraft(null)
    // Replace, not push: Back from the tab must not reopen the editor (the installed app has no browser chrome).
    location.replace(`#${lastTab()}`)
  }

  // Copies the content into a fresh draft; the new rows get their own IDs, so it really posts again.
  function postAgain() {
    // An upload is removed once its by-hand post is marked done (see Handoff), so don't copy a dead link.
    const gone = rows.some(mediaWasRemoved)
    saveDraft({
      targets, caption, firstComment, variants, link, mode: 'now', publishAt: '',
      mediaType: gone ? 'none' : mediaType,
      mediaUrl: gone ? '' : mediaUrl,
      coverUrl: gone ? '' : coverUrl,
      videoSeconds: gone ? null : seconds,
      note: gone ? 'The original file was removed after you posted it by hand. Add it again.' : undefined,
    })
    go('/new')
  }

  async function remove() {
    if (!rows.length || !confirm(rows.length > 1 ? `Delete this post from all ${rows.length} accounts? This cannot be undone.` : 'Delete this post? This cannot be undone.')) return
    // If the publisher claimed a row meanwhile, deleting would leave a live post with no record.
    const { data, error } = await supabase.from('posts').delete().in('num', rows.map((r) => r.num)).neq('status', 'posting').select('num')
    if (error) return setError(error.message)
    if (data.length < rows.length) return setError(PUBLISHING_NOW)
    location.replace(`#${lastTab()}`)
  }

  // Wait for accounts (and, when editing, the post) before choosing a screen, so nothing flashes on load.
  const skeleton = <div className="tray" aria-busy="true"><div className="core"><div className="skeleton" aria-hidden="true" /><div className="skeleton" aria-hidden="true" /></div></div>
  if (accounts === null) return skeleton
  if (accounts.length === 0 && !error) {
    return (
      <section className="hero sky rise">
        <h1>Add an account</h1>
        <p>Posts belong to an account: your Facebook Page and Instagram, or just your phone for by-hand platforms.</p>
        <a className="btn primary" href="#/accounts" style={{ alignSelf: 'flex-start' }}>Add account<span className="knob"><Arrow /></span></a>
        <FlightPath />
        <Asteroids />
      </section>
    )
  }
  if (num && !rows.length && !error) return skeleton

  const links = rows.flatMap((r) => postLinks(r).map((l) => ({ ...l, account: r.account_id })))
  const accountName = (id: number) => accounts.find((a) => a.id === id)?.name ?? ''
  const canDelete = rows.length > 0 && !rows.some(postedByApi)
  const showComment = commentOpen || !!firstComment
  const mediaValue = busy === 'upload' ? 'Uploading…' : !mediaUrl ? 'None' : mediaType === 'video' ? 'Video' : 'Photo'

  // The preview, with the per-platform text editors above it (a sheet on phone, a column on wide screens).
  const preview = (
    <div className="c-preview">
      {chosen.length > 0 && (
        <div className="c-pv-edit">
          <span id="pv-edit" className="legend">Text per platform</span>
          <div role="group" aria-labelledby="pv-edit" className="filters" style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
            <button type="button" aria-pressed={editing === 'all'} onClick={() => setTab('all')}>All platforms</button>
            {chosen.map((p) => (
              <button key={p} type="button" aria-pressed={editing === p} onClick={() => setTab(p)}>
                {PLATFORM_NAMES[p]}{isCustomized(variants, p) && <span aria-label=" (customized)" style={{ color: 'var(--accent)' }}> ●</span>}
              </button>
            ))}
          </div>
          {editing !== 'all' && (
            <fieldset className="bare" disabled={locked}>
              <PlatformText p={editing} base={caption} variants={variants} set={setVariant} />
            </fieldset>
          )}
        </div>
      )}
      {chosen.length > 0 ? (
        <PostPreview platforms={chosen} caption={caption} firstComment={firstComment} variants={variants} link={link} mediaType={mediaType} mediaUrl={mediaUrl}
          accountFor={(p) => active.find((a) => targets[a.id].includes(p))?.name ?? ''} />
      ) : (
        <p className="c-quiet">Pick where it goes to see how it will look.</p>
      )}
    </div>
  )

  return (
    <form className={wide ? 'compose wide' : 'compose'} onSubmit={(e) => { e.preventDefault(); save('scheduled') }}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save('scheduled') }
      }}
      onPaste={(e) => {
        const file = e.clipboardData.files[0]
        if (file && ACCEPT.split(',').includes(file.type)) { e.preventDefault(); upload(file) }
      }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true) } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false) }}
      onDrop={(e) => {
        const file = e.dataTransfer.files[0]
        if (!file) return
        e.preventDefault()
        setDragging(false)
        upload(file)
      }}>
      <div className="c-main">
        <div className="c-top rise">
          <a className="c-round glass" href={`#${lastTab()}`} aria-label="Close"
            onClick={(e) => { e.preventDefault(); location.replace(`#${lastTab()}`) }}><Close /></a>
          <h1>{num ? 'Edit post' : 'New post'}</h1>
          {!wide && <button type="button" className="c-pill glass" onClick={() => setSheet('preview')} aria-haspopup="dialog"><Eye />Preview</button>}
        </div>

        {(restored?.note || hasDraft || locked || error || rows.some((r) => r.last_error)) && (
          <div className="c-notes">
            {restored?.note && <p className="notice" role="status">{restored.note}</p>}
            {hasDraft && (
              <p className="c-restored">
                Draft restored from last time.{' '}
                <button type="button" className="link-btn" onClick={() => {
                  saveDraft(null)
                  location.replace(`#/new${fromDay ? `?day=${fromDay}` : ''}`) // keep the Planned day across the reload
                  location.reload()
                }}>Start fresh</button>
              </p>
            )}
            {locked && <p className="notice" role="status">This post is being published right now. Edit it after the run finishes.</p>}
            {rows.filter((r) => r.last_error).map((r) => (
              <p key={r.num} className="notice" role="status">{rows.length > 1 ? `${accountName(r.account_id)}: ` : ''}{r.last_error}</p>
            ))}
            {error && <p className="notice" role="alert">{error}</p>}
          </div>
        )}

        <fieldset className={dragging ? 'bare c-write tray rise over' : 'bare c-write tray rise'} disabled={locked} onBlur={touch('caption')}>
          <div className="core">
            <label htmlFor="caption" className="sr-only">Caption, used everywhere unless a platform overrides it</label>
            <textarea id="caption" className="c-caption" placeholder={dragging ? 'Drop to add it' : 'Write your post…'} value={caption}
              onChange={(e) => setCaption(e.target.value)} {...invalid('caption')} />
            <div className="c-meta">
              {!showComment && (
                <button type="button" className="link-btn" aria-expanded="false" onClick={() => setCommentOpen(true)}>+ First comment</button>
              )}
              <span className="mono" aria-live="polite">{caption.length.toLocaleString('en')} chars · {hashtagCount(caption)} hashtags</span>
            </div>
            {showComment && (
              <div className="field">
                <label htmlFor="first-comment">First comment <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional)</span></label>
                <textarea id="first-comment" className="input" value={firstComment} readOnly={commentLocked} autoFocus={commentOpen && !firstComment}
                  onChange={(e) => setFirstComment(e.target.value)}
                  {...invalid('caption')} aria-describedby={shown('caption').length ? 'first-comment-hint err-caption' : 'first-comment-hint'} />
                <span id="first-comment-hint" style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {commentLocked ? 'Already live: add or change the comment in Facebook/Instagram.'
                    : "Posted as a comment on Facebook and Instagram; copy it on your phone for the others. Instagram links aren't clickable."}
                </span>
              </div>
            )}
            {/* Unlike the rows, caption problems wait until you've left the caption: an empty post isn't a mistake yet. */}
            <FieldError id="err-caption" messages={shown('caption')} />
          </div>
        </fieldset>

        <div className="c-rows tray rise">
          <div className="core flush">
            <SettingRow name="media" label="Media" value={mediaValue} warnings={errors.media} alert={shown('media').length > 0} onOpen={() => setSheet('media')}
              icon={mediaType === 'image' && mediaUrl ? <span className="s-thumb" style={{ backgroundImage: `url("${mediaUrl}")` }} /> : <MediaIcon />} />
            {mediaType === 'video' && (
              <SettingRow name="cover" label="Cover" value={busy === 'cover' ? 'Uploading…' : coverUrl ? 'Added' : 'None'} onOpen={() => setSheet('cover')}
                icon={coverUrl ? <span className="s-thumb" style={{ backgroundImage: `url("${coverUrl}")` }} /> : <MediaIcon />} />
            )}
            <SettingRow name="where" label="Where" value={whereSummary(targets, accounts)} warnings={errors.where} alert={shown('where').length > 0}
              icon={<WhereIcon />} onOpen={() => setSheet('where')} />
            <SettingRow name="when" label="When" value={whenSummary(mode, publishAt, tz)} warnings={errors.when} alert={shown('when').length > 0}
              icon={<WhenIcon />} onOpen={() => setSheet('when')} />
            <SettingRow name="link" label="Link" value={linkSummary(link)} icon={<LinkIcon />} onOpen={() => setSheet('link')} />
          </div>
        </div>

        <div className="c-bar glass">
          {rows.length > 0 && (
            <button type="button" className="c-round c-more" aria-label="More actions" aria-haspopup="dialog" onClick={() => setSheet('more')}><More /></button>
          )}
          <button type="button" className="btn" disabled={busy !== '' || locked} onClick={() => save('draft')}>Save draft</button>
          <button type="submit" className="btn primary" disabled={busy !== '' || locked}>
            {busy === 'save' ? 'Saving…' : mode === 'now' ? 'Post now' : 'Schedule'}
            <span className="knob"><Arrow /></span>
          </button>
        </div>
      </div>

      {wide && <aside className="c-side rise" aria-label="Preview">{preview}</aside>}

      <Sheet open={sheet === 'media'} onClose={closeSheet('media')} title="Media">
        <fieldset className="bare field" disabled={locked}>
          {/* The whole box is the file picker: click, drop or paste. */}
          <label className={`dropzone${dragging ? ' over' : ''}`}>
            <span className="thumb" aria-hidden="true" style={mediaType === 'image' && mediaUrl ? { width: 64, height: 64, backgroundImage: `url("${mediaUrl}")`, color: 'transparent' } : { width: 64, height: 64 }}>
              {mediaType === 'none' ? 'None' : mediaType}
            </span>
            <span className="dz-text">
              <span className="dz-title">{busy === 'upload' ? 'Uploading…' : dragging ? 'Drop to upload' : mediaUrl ? `${mediaType === 'video' ? 'Video' : 'Image'} added` : 'Add a photo or video'}</span>
              <span className="dz-hint">{mediaUrl ? 'Tap to replace it' : 'Tap, drop or paste · JPEG, PNG, WebP, MP4 · up to 50 MB'}</span>
            </span>
            <span className="btn dark" aria-hidden="true" style={{ minHeight: 44 }}>{mediaUrl ? 'Replace' : 'Choose file'}</span>
            <input id="media-file" type="file" className="sr-only" accept={ACCEPT} disabled={busy === 'upload'} {...invalid('media')}
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
          <FieldError messages={errors.media} alert={false} />
          {/* The page behind a sheet is inert, so an upload failure is shown (and announced) here too. */}
          {error && <p className="notice" role="alert">{error}</p>}
          {mediaUrl && (
            <button type="button" className="link-btn" onClick={() => {
              setMediaUrl('')
              setMediaType('none')
              setCoverUrl('')
              setSeconds(null)
              const remembered = rememberedTargets('none')
              if (!num && remembered) setTargets(remembered)
            }}>
              Remove media
            </button>
          )}
        </fieldset>
      </Sheet>

      <Sheet open={sheet === 'cover'} onClose={closeSheet('cover')} title="Cover">
        <fieldset className="bare field" disabled={locked}>
          <label className="dropzone">
            <span className="thumb" aria-hidden="true" style={coverUrl ? { width: 64, height: 64, backgroundImage: `url("${coverUrl}")`, color: 'transparent' } : { width: 64, height: 64 }}>
              None
            </span>
            <span className="dz-text">
              <span className="dz-title">{busy === 'cover' ? 'Uploading…' : coverUrl ? 'Cover added' : 'Add a cover image'}</span>
              <span className="dz-hint">{coverUrl ? 'Tap to replace it' : 'Optional · JPEG, PNG or WebP · used where the platform allows it'}</span>
            </span>
            <span className="btn dark" aria-hidden="true" style={{ minHeight: 44 }}>{coverUrl ? 'Replace' : 'Choose image'}</span>
            <input id="cover-file" type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" disabled={busy !== ''}
              onChange={(e) => e.target.files?.[0] && uploadCover(e.target.files[0])} />
          </label>
          <FieldError messages={errors.media.filter((m) => /cover/i.test(m))} alert={false} />
          {error && <p className="notice" role="alert">{error}</p>}
          {coverUrl && <button type="button" className="link-btn" onClick={() => setCoverUrl('')}>Remove cover</button>}
        </fieldset>
      </Sheet>

      <Sheet open={sheet === 'where'} onClose={closeSheet('where')} title="Where">
        <fieldset id="where" className="bare" disabled={locked} style={{ display: 'flex', flexDirection: 'column', gap: 12 }} {...invalid('where')}>
          <legend className="sr-only">Where</legend>
          {accounts.map((a) => {
            const row = rowOf(a.id)
            // Only this account's own logins (plus anything an older post already had here, so it can be unticked).
            const usable = PLATFORMS.filter((p) => !isHandPlatform(p) && (ownLogin(p, a) || (p !== 'tiktok' && !!targets[a.id]?.includes(p))))
            const picked = (targets[a.id] ?? []).filter((p) => usable.includes(p))
            return (
              <div key={a.id} className="target" data-on={picked.length ? '' : undefined}>
                <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{a.name}</span>
                  <span className="mono">{picked.length ? `${picked.length} selected` : usable.length ? 'Not posting here' : ''}</span>
                </span>
                {usable.length ? (
                  <div role="group" aria-label={`Platforms for ${a.name}`} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {usable.map((p) => {
                      const done = !!row && row.platforms.includes(p) && isDone(row, p)
                      const on = !!targets[a.id]?.includes(p)
                      return (
                        <button key={p} type="button" className="toggle" aria-pressed={on} disabled={done}
                          title={done ? 'Already posted here' : undefined} onClick={() => toggle(a.id, p)}>
                          {on && <Check />}
                          {PLATFORM_NAMES[p]}
                          <span className="toggle-mode">{done ? 'Posted' : p === 'tiktok' ? 'Drafts' : 'Auto'}</span>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <span style={{ fontSize: 14, color: 'var(--muted)' }}>No logins yet. <a href="#/accounts">Connect one on Accounts</a>.</span>
                )}
              </div>
            )
          })}
          {/* By-hand platforms belong to no login: they come to your phone, once, whichever accounts you pick. */}
          <div className="target" data-on={handOn.length ? '' : undefined}>
            <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>To your phone</span>
              <span className="mono">{handOn.length ? `${handOn.length} selected` : 'Post these by hand'}</span>
            </span>
            <div role="group" aria-label="Platforms you post by hand" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {handPlatforms.map((p) => {
                const on = handOn.includes(p)
                const done = rows.some((r) => r.platforms.includes(p) && isDone(r, p))
                return (
                  <button key={p} type="button" className="toggle" aria-pressed={on} disabled={done}
                    title={done ? 'Already sent to your phone' : undefined} onClick={() => toggleHand(p)}>
                    {on && <Check />}
                    {PLATFORM_NAMES[p]}
                    <span className="toggle-mode">{done ? 'Sent' : 'By hand'}</span>
                  </button>
                )
              })}
            </div>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>The caption and file come to Telegram and the handoff page; you post them yourself.</span>
          </div>
          <FieldError messages={errors.where} alert={false} />
        </fieldset>
      </Sheet>

      <Sheet open={sheet === 'when'} onClose={closeSheet('when')} title="When">
        <fieldset className="bare field" disabled={locked}>
          <div id="when-mode" role="group" aria-label="When to post" className="filters" style={{ alignSelf: 'flex-start' }}>
            <button type="button" aria-pressed={mode === 'now'} onClick={() => setMode('now')}>Post now</button>
            <button type="button" aria-pressed={mode === 'later'} onClick={() => setMode('later')}>Schedule</button>
          </div>
          {mode === 'later' && (
            <>
              <label htmlFor="when" className="sr-only">Post at ({tz})</label>
              <input id="when" className="input" type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} {...invalid('when')} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {quickTimes(tz).map((c) => (
                  <button key={c.label} type="button" className="chip queued" onClick={() => setPublishAt(c.value)}
                    aria-pressed={publishAt === c.value} style={{ height: 44, padding: '0 14px', cursor: 'pointer', border: 0, fontFamily: 'var(--sans)' }}>
                    {c.label}
                  </button>
                ))}
              </div>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{tz} time{active.length > 1 ? ', for every account' : ''}</span>
            </>
          )}
          <FieldError messages={errors.when} alert={false} />
        </fieldset>
      </Sheet>

      <Sheet open={sheet === 'link'} onClose={closeSheet('link')} title="Link">
        <fieldset className="bare field" disabled={locked}>
          <label htmlFor="link">Link <span style={{ fontWeight: 400, color: 'var(--muted)' }}>· Facebook and X</span></label>
          <input id="link" className="input" type="url" inputMode="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
        </fieldset>
      </Sheet>

      <Sheet open={sheet === 'preview' && !wide} onClose={closeSheet('preview')} title="Preview">{preview}</Sheet>

      <Sheet open={sheet === 'more'} onClose={closeSheet('more')} title="More">
        <div className="c-more-list">
          {links.map((l) => (
            <a key={`${l.account}-${l.platform}`} className="btn light" href={l.url} target="_blank" rel="noopener">
              View on {NAMED[l.platform]}{rows.length > 1 ? ` · ${accountName(l.account)}` : ''}<span className="knob"><Arrow /></span>
            </a>
          ))}
          <button type="button" className="btn" onClick={postAgain}>Post again</button>
          {/* Close the sheet first, so a failed delete's message isn't hidden behind it. */}
          {canDelete && <button type="button" className="btn danger" disabled={locked} onClick={() => { setSheet(''); remove() }}>Delete</button>}
        </div>
      </Sheet>
    </form>
  )
}

// Where a blocked save puts focus for each section: the caption, or the row that opens the section's sheet.
const FOCUS: Record<Section, string> = {
  media: '#row-media',
  caption: '#caption',
  where: '#row-where',
  when: '#row-when',
}

function PlatformText({ p, base, variants, set }: {
  p: Platform
  base: string
  variants: Variants
  set: (p: Platform, key: keyof Variant, value: string) => void
}) {
  const v = variants[p] ?? {}
  const text = textFor(base, variants, p)
  const limit = p === 'instagram' ? ` / ${IG_CAPTION_MAX.toLocaleString('en')}` : ''
  const sub = { fontWeight: 400, color: 'var(--muted)' }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {p === 'youtube' && (
        <div className="field">
          <span style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '4px 12px' }}>
            <label htmlFor="v-title">YouTube title</label>
            <span className="mono">{(v.title ?? '').length} / {YOUTUBE_TITLE_MAX}</span>
          </span>
          <input id="v-title" className="input" maxLength={YOUTUBE_TITLE_MAX + 20} value={v.title ?? ''} onChange={(e) => set(p, 'title', e.target.value)} />
        </div>
      )}
      <div className="field">
        <span style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '4px 12px' }}>
          <label htmlFor="v-caption">Caption for {PLATFORM_NAMES[p]} <span style={sub}>· empty = main caption</span></label>
          <span className="mono" aria-live="polite">{text.length.toLocaleString('en')}{limit} · {hashtagCount(text)} hashtags</span>
        </span>
        <textarea id="v-caption" className="input" placeholder={base || 'Main caption is empty'} value={v.caption ?? ''}
          onChange={(e) => set(p, 'caption', e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="v-tags">Hashtags for {PLATFORM_NAMES[p]} <span style={sub}>· added on a new line</span></label>
        <input id="v-tags" className="input" placeholder="#kape #manilacafe" value={v.hashtags ?? ''} onChange={(e) => set(p, 'hashtags', e.target.value)} />
      </div>
      {isCustomized(variants, p) && (
        <button type="button" className="link-btn" onClick={() => { set(p, 'caption', ''); set(p, 'hashtags', ''); set(p, 'title', '') }}>
          Use the main caption for {PLATFORM_NAMES[p]}
        </button>
      )}
    </div>
  )
}
