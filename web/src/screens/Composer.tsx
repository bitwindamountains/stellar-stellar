import { useEffect, useState } from 'react'
import { cleanVariants, isCustomized, textFor, type Variant, type Variants } from '../content'
import { Alert, Arrow, Asteroids, Check, FlightPath, launchNext } from '../icons'
import { publishSoon } from '../actions'
import { postLinks } from '../groups'
import { toJpeg } from '../media'
import { mediaWasRemoved } from '../postView'
import PostPreview from '../PostPreview'
import { takeShared } from '../share'
import { draftTargets, loadDraft, rememberChoices, rememberedTargets, saveDraft, type Targets } from '../prefs'
import { go, takeQuery } from '../route'
import { reveal } from '../scroll'
import { bySection, SECTIONS, type Section } from '../fields'
import { supabase } from '../supabase'
import { quickTimes, utcToZoned, zonedToUtc } from '../time'
import { ACCOUNT_SELECT, byHand, canPost, isConnected, isDone, postedByApi, PLATFORM_CODES, PLATFORM_NAMES, PLATFORMS, type Account, type MediaType, type Platform, type Post } from '../types'
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

export default function Composer({ num }: { num?: number }) {
  const [restored] = useState(() => (num ? null : loadDraft()))
  const [accounts, setAccounts] = useState<Account[] | null>(null) // null = still loading
  const [rows, setRows] = useState<Post[]>([]) // the stored rows when editing (several for a multi-account post)
  const [targets, setTargets] = useState<Targets>({})
  const [publishAt, setPublishAt] = useState(restored?.publishAt ?? '')
  // Daily posting is the common case, so new posts default to going out now.
  const [mode, setMode] = useState<'now' | 'later'>(restored?.mode ?? 'now')
  const [caption, setCaption] = useState(restored?.caption ?? '')
  const [firstComment, setFirstComment] = useState(restored?.firstComment ?? '')
  const [variants, setVariants] = useState<Variants>(restored?.variants ?? {})
  const [tab, setTab] = useState<'all' | Platform>('all')
  const [mediaType, setMediaType] = useState<MediaType>(restored?.mediaType ?? 'none')
  const [mediaUrl, setMediaUrl] = useState(restored?.mediaUrl ?? '')
  const [link, setLink] = useState(restored?.link ?? '')
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState<'' | 'upload' | 'save'>('')
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
      setLink(lead.link)
    })()
  }, [num, accounts])

  useEffect(() => {
    if (num) return
    saveDraft({ targets, caption, firstComment, variants, mediaType, mediaUrl, link, mode, publishAt })
  }, [num, targets, caption, firstComment, variants, mediaType, mediaUrl, link, mode, publishAt])

  useEffect(() => {
    if (num) return
    // Opened from an empty day on the Queue's week strip: schedule for that day.
    const date = takeQuery().get('date')
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) { setMode('later'); setPublishAt(`${date}T09:00`) }
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
  const base = { publishAt, caption, firstComment, variants, mediaType, mediaUrls: mediaUrl ? [mediaUrl] : [], link }
  const editing = tab !== 'all' && chosen.includes(tab) ? tab : 'all' // a deselected platform's tab falls back
  const problems = problemsFor(active, targets, base, mode === 'later')
  const locked = rows.some((r) => r.status === 'posting')
  // Once live, the comment can't be added from here (the publisher only posts it with the post).
  const commentLocked = rows.some((r) => r.fb_post_id || r.ig_media_id)
  const when = mode === 'now' ? 'once posted' : publishAt ? publishAt.slice(11, 16) : 'post time'
  const rowOf = (id: number) => rows.find((r) => r.account_id === id)
  const errors = bySection(problems)
  // Errors show once a section has been left (or after a blocked save), not while you're still filling it in.
  const shown = (s: Section) => (tried || touched.includes(s) ? errors[s] : [])
  const touch = (s: Section) => (e: React.FocusEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return // still inside the section
    setTouched((t) => (t.includes(s) ? t : [...t, s]))
  }
  const invalid = (s: Section) => (shown(s).length ? { 'aria-invalid': true, 'aria-describedby': `err-${s}` } : {})

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
    if (file.size > MAX_BYTES) {
      setBusy('')
      return setError('Files over 50 MB are too big for the free plan; shrink it first')
    }
    const { data: auth } = await supabase.auth.getUser()
    const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
    // Random name in the user's own folder: storage policies only allow that folder.
    const path = `${auth.user?.id}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from('media').upload(path, file, { contentType: file.type })
    setBusy('')
    if (error) return setError(error.message)
    setMediaUrl(supabase.storage.from('media').getPublicUrl(path).data.publicUrl)
    setMediaType(kind)
    if (remembered) setTargets(remembered)
  }

  async function save(status: 'draft' | 'scheduled') {
    if (busy || !accounts) return // Ctrl+Enter skips the disabled buttons; never save mid-upload or twice
    setTried(true)
    const blocked = problemsFor(active, targets, base, status === 'scheduled' && mode === 'later')
    if (blocked.length || !lead) {
      // Move focus to the first section with a problem; its message is right under it.
      const first = SECTIONS.find((s) => bySection(blocked)[s].length)
      const target = first && document.querySelector<HTMLElement>(FOCUS[first])
      if (target) target.focus()
      else reveal('checks', 'center')
      return
    }
    setBusy('save')
    const shared = {
      publish_at: status === 'scheduled' && mode === 'now' ? new Date().toISOString()
        : publishAt ? zonedToUtc(publishAt, tz) : null,
      caption,
      ...(commentLocked ? {} : { first_comment: firstComment }),
      media_type: mediaType,
      media_urls: mediaUrl ? [mediaUrl] : [],
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
      const { error } = await supabase.from('posts').insert(added.map(fieldsFor))
      if (error) failures.push(error.message)
    }
    const ok = !failures.length && !conflict
    if (ok && status === 'scheduled' && mode === 'now') await publishSoon()
    setBusy('')
    if (failures.length) return setError(failures.join(' · '))
    if (conflict) return setError(PUBLISHING_NOW)
    rememberChoices(mediaType, Object.fromEntries(active.map((a) => [a.id, targets[a.id]])))
    if (!num) saveDraft(null)
    if (status === 'scheduled' && mode === 'now') launchNext()
    go('/')
  }

  // Copies the content into a fresh draft; the new rows get their own IDs, so it really posts again.
  function postAgain() {
    // An upload is removed once its by-hand post is marked done (see Handoff), so don't copy a dead link.
    const gone = rows.some(mediaWasRemoved)
    saveDraft({
      targets, caption, firstComment, variants, link, mode: 'now', publishAt: '',
      mediaType: gone ? 'none' : mediaType,
      mediaUrl: gone ? '' : mediaUrl,
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
    go('/')
  }

  // Wait for accounts before choosing a screen, so the empty state never flashes on load.
  if (accounts === null) return <div className="tray" aria-busy="true"><div className="core"><div className="skeleton" aria-hidden="true" /><div className="skeleton" aria-hidden="true" /></div></div>
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

  const planText = (p: Platform, a: Account) => {
    const row = rowOf(a.id)
    if (row && isDone(row, p)) return 'Already done. It will not be posted again.'
    if (p === 'facebook') return link && mediaUrl ? 'Posted to your Page with the link in the caption.' : 'Posted to your Page.'
    if (p === 'instagram') return 'Posted as a single image. Retries up to 3 times if Instagram is busy.'
    if (p === 'x') return link ? 'Posted to X with the link (X charges more for posts with links).' : 'Posted to X.'
    if (p === 'tiktok' && !byHand(p, a)) return 'Uploaded to your TikTok drafts; finish it in TikTok.'
    return 'Sent to your phone with the caption ready to paste.'
  }
  const links = rows.flatMap((r) => postLinks(r).map((l) => ({ ...l, account: r.account_id })))
  const accountName = (id: number) => accounts.find((a) => a.id === id)?.name ?? ''

  return (
    <>
      <header className="hero sky rise">
        <h1>{num ? `Edit post #${num}` : 'Write it once'}</h1>
        <p>Pick where it goes, on one account or several. PostPilot checks it now, not at post time.</p>
        {restored?.note && <p className="notice" role="status" style={{ fontSize: 14 }}>{restored.note}</p>}
        {restored && (restored.caption || restored.mediaUrl) && (
          <p style={{ fontSize: 14 }}>
            Draft restored from last time.{' '}
            <button type="button" className="link-btn" onClick={() => { saveDraft(null); window.location.reload() }}>Start fresh</button>
          </p>
        )}
        {locked && <p className="notice" role="status">This post is being published right now. Edit it after the run finishes.</p>}
        {rows.filter((r) => r.last_error).map((r) => (
          <p key={r.num} className="notice" role="status">{rows.length > 1 ? `${accountName(r.account_id)}: ` : ''}{r.last_error}</p>
        ))}
        {rows.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
            {links.map((l) => (
              <a key={`${l.account}-${l.platform}`} className="btn light" href={l.url} target="_blank" rel="noopener">
                View on {NAMED[l.platform]}{rows.length > 1 ? ` · ${accountName(l.account)}` : ''}<span className="knob"><Arrow /></span>
              </a>
            ))}
            <button type="button" className="btn" onClick={postAgain}>Post again</button>
          </div>
        )}
        {error && <p className="notice" role="alert">{error}</p>}
        <FlightPath />
        <Asteroids />
      </header>

      <form className="split" onSubmit={(e) => { e.preventDefault(); save('scheduled') }}
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
        <section className="main tray rise" aria-label="Post">
          <fieldset className="core" disabled={locked} style={{ gap: 28, border: 0, margin: 0, minWidth: 0 }}>
            <div className="field" onBlur={touch('media')}>
              <span className="legend">Media</span>
              {/* The whole box is the file picker: click, drop or paste. */}
              <label className={`dropzone${dragging ? ' over' : ''}`}>
                <span className="thumb" aria-hidden="true" style={mediaType === 'image' && mediaUrl ? { width: 64, height: 64, backgroundImage: `url("${mediaUrl}")`, color: 'transparent' } : { width: 64, height: 64 }}>
                  {mediaType === 'none' ? 'None' : mediaType}
                </span>
                <span className="dz-text">
                  <span className="dz-title">{busy === 'upload' ? 'Uploading…' : dragging ? 'Drop to upload' : mediaUrl ? `${mediaType === 'video' ? 'Video' : 'Image'} added` : 'Add a photo or video'}</span>
                  <span className="dz-hint">{mediaUrl ? 'Click to replace it' : 'Click, drop or paste · JPEG, PNG, WebP, MP4 · up to 50 MB'}</span>
                </span>
                <span className="btn dark" aria-hidden="true" style={{ minHeight: 44 }}>{mediaUrl ? 'Replace' : 'Choose file'}</span>
                <input id="media-file" type="file" className="sr-only" accept={ACCEPT} disabled={busy === 'upload'} {...invalid('media')}
                  onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              </label>
              <FieldError section="media" messages={shown('media')} />
              {mediaUrl && (
                <button type="button" className="link-btn" onClick={() => {
                  setMediaUrl('')
                  setMediaType('none')
                  const remembered = rememberedTargets('none')
                  if (!num && remembered) setTargets(remembered)
                }}>
                  Remove media
                </button>
              )}
            </div>

            <div className="field" style={{ gap: 12 }} onBlur={touch('caption')}>
              <div role="group" aria-label="Edit the text for" className="filters" style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
                <button type="button" aria-pressed={editing === 'all'} onClick={() => setTab('all')}>All platforms</button>
                {chosen.map((p) => (
                  <button key={p} type="button" aria-pressed={editing === p} onClick={() => setTab(p)}>
                    {PLATFORM_NAMES[p]}{isCustomized(variants, p) && <span aria-label=" (customized)" style={{ color: 'var(--accent)' }}> ●</span>}
                  </button>
                ))}
              </div>
              {editing === 'all' ? (
                <>
                  <span style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '4px 12px' }}>
                    <label htmlFor="caption" className="legend">Caption <span style={{ fontWeight: 400, color: 'var(--muted)' }}>· used everywhere unless a platform overrides it</span></label>
                    <span className="mono" aria-live="polite">{caption.length.toLocaleString('en')} chars · {hashtagCount(caption)} hashtags</span>
                  </span>
                  <textarea id="caption" className="input" value={caption} onChange={(e) => setCaption(e.target.value)} {...invalid('caption')} />
                  <label htmlFor="first-comment" className="legend">First comment <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional)</span></label>
                  <textarea id="first-comment" className="input" value={firstComment} readOnly={commentLocked} onChange={(e) => setFirstComment(e.target.value)} />
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                    {commentLocked ? 'Already live: add or change the comment in Facebook/Instagram.'
                      : "Posted as a comment on Facebook and Instagram; copy it on your phone for the others. Instagram links aren't clickable."}
                  </span>
                </>
              ) : (
                <PlatformText p={editing} base={caption} variants={variants} set={setVariant} />
              )}
              <FieldError section="caption" messages={shown('caption')} />
            </div>

            <fieldset id="where" style={{ margin: 0, padding: 0, border: 0, display: 'flex', flexDirection: 'column', gap: 12 }} onBlur={touch('where')} {...invalid('where')}>
              <legend className="legend" style={{ padding: 0, marginBottom: 12 }}>Where</legend>
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
              <FieldError section="where" messages={shown('where')} />
            </fieldset>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              <div className="field" style={{ flex: '1 1 280px', minWidth: 0 }} onBlur={touch('when')}>
                <span className="legend">When</span>
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
                <FieldError section="when" messages={shown('when')} />
              </div>
              <div className="field" style={{ flex: '1 1 280px', minWidth: 0 }}>
                <label htmlFor="link">Link <span style={{ fontWeight: 400, color: 'var(--muted)' }}>· Facebook and X</span></label>
                <input id="link" className="input" type="url" inputMode="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
              </div>
            </div>

            <div className="actions">
              {rows.length > 0 && !rows.some(postedByApi) && (
                <button type="button" className="btn danger" onClick={remove} style={{ marginRight: 'auto' }}>Delete</button>
              )}
              <button type="button" className="btn" disabled={busy !== ''} onClick={() => save('draft')}>Save draft</button>
              <button type="submit" className="btn primary" disabled={busy !== ''}>
                {busy === 'save' ? 'Saving…' : mode === 'now' ? 'Post now' : publishAt ? `Schedule for ${when}` : 'Schedule'}
                <span className="knob"><Arrow /></span>
              </button>
            </div>
          </fieldset>
        </section>

        <aside className="side" aria-label="Checks, preview and plan">
          <section className="tray rise" id="checks">
            <div className="core">
              <h2>Checks</h2>
              <ul aria-live="polite" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 14, lineHeight: 1.45 }}>
                {problems.length === 0 ? (
                  <li className="ok" style={{ display: 'flex', gap: 12 }}><Check label="OK" />Ready to schedule</li>
                ) : (
                  problems.map((p) => (
                    <li key={p} style={{ display: 'flex', gap: 12, padding: 14, borderRadius: 16,
                      background: tried ? 'var(--warn-tint)' : 'var(--well)', color: tried ? '#6e2e05' : 'var(--ink-2)' }}>
                      <Alert label="To fix" />{p}
                    </li>
                  ))
                )}
              </ul>
            </div>
          </section>
          {chosen.length > 0 && (
            <PostPreview platforms={chosen} caption={caption} firstComment={firstComment} variants={variants} link={link} mediaType={mediaType} mediaUrl={mediaUrl}
              accountFor={(p) => active.find((a) => targets[a.id].includes(p))?.name ?? ''} />
          )}
          {active.length > 0 && (
            <section className="tray rise">
              <div className="core dark">
                <h2 style={{ color: '#fff' }}>{mode === 'now' ? 'When you post' : `At ${when}`}</h2>
                <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {active.flatMap((a) => targets[a.id].map((p) => ({ a, p }))).map(({ a, p }, i) => (
                    <li key={`${a.id}-${p}`} style={{ display: 'flex', gap: 16, padding: '14px 0', borderTop: i ? '1px solid rgba(255,255,255,0.08)' : 0 }}>
                      <span className="mono" style={{ width: 32, lineHeight: '20px', color: byHand(p, a) ? '#afc0ff' : '#c9cbcf' }}>{PLATFORM_CODES[p]}</span>
                      <span style={{ fontSize: 14, lineHeight: 1.45 }}>{active.length > 1 && <strong style={{ fontWeight: 600 }}>{ownLogin(p, a) ? a.name : 'Your phone'}: </strong>}{planText(p, a)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </section>
          )}
        </aside>
      </form>
    </>
  )
}

// Where a blocked save puts focus for each section.
const FOCUS: Record<Section, string> = {
  media: '#media-file',
  caption: '#caption, #v-title, #v-caption, #first-comment',
  where: '#where .toggle:not(:disabled)',
  when: '#when, #when-mode button',
}

/** A section's problems, right under it; the field points at it with aria-describedby. */
function FieldError({ section, messages }: { section: Section; messages: string[] }) {
  if (!messages.length) return null
  return (
    <ul id={`err-${section}`} className="field-error">
      {messages.map((m) => <li key={m}><Alert label="Problem" />{m}</li>)}
    </ul>
  )
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
