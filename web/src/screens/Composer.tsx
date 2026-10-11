import { useEffect, useState } from 'react'
import { cleanVariants, isCustomized, textFor, type Variant, type Variants } from '../content'
import { Alert, Arrow, Check } from '../icons'
import { go } from '../route'
import { supabase } from '../supabase'
import { utcToZoned, zonedToUtc } from '../time'
import { isAssisted, isDone, PLATFORM_CODES, PLATFORM_NAMES, PLATFORMS, type Account, type MediaType, type Platform, type Post } from '../types'
import { hashtagCount, IG_CAPTION_MAX, validate, YOUTUBE_TITLE_MAX } from '../validation'

const ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime'
const MAX_BYTES = 50 * 1024 * 1024 // matches the bucket's file_size_limit

export default function Composer({ num }: { num?: number }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null) // null = still loading
  const [post, setPost] = useState<Post | null>(null)
  const [accountId, setAccountId] = useState<number | ''>('')
  const [platforms, setPlatforms] = useState<Platform[]>(['facebook', 'instagram'])
  const [publishAt, setPublishAt] = useState('')
  const [caption, setCaption] = useState('')
  const [variants, setVariants] = useState<Variants>({})
  const [tab, setTab] = useState<'all' | Platform>('all')
  const [mediaType, setMediaType] = useState<MediaType>('none')
  const [mediaUrl, setMediaUrl] = useState('')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState<'' | 'upload' | 'save'>('')
  const [error, setError] = useState('')
  const [tried, setTried] = useState(false)

  useEffect(() => {
    supabase.from('accounts').select('*').order('name').then(({ data, error }) => {
      if (error) return setError(error.message)
      const list = (data as Account[]) ?? []
      setAccounts(list)
      if (!num && list.length) setAccountId(list[0].id)
    })
  }, [num])

  useEffect(() => {
    if (!num || !accounts?.length) return
    supabase.from('posts').select('*').eq('num', num).single().then(({ data, error }) => {
      if (error) return setError(error.message)
      const p = data as Post
      const tz = accounts.find((a) => a.id === p.account_id)?.timezone ?? 'Asia/Manila'
      setPost(p)
      setAccountId(p.account_id)
      setPlatforms(p.platforms)
      setPublishAt(p.publish_at ? utcToZoned(p.publish_at, tz) : '')
      setCaption(p.caption)
      setVariants((p.variants as Variants) ?? {})
      setMediaType(p.media_type)
      setMediaUrl(p.media_urls[0] ?? '')
      setLink(p.link)
    })
  }, [num, accounts])

  const account = accounts?.find((a) => a.id === accountId)
  const draft = { account, platforms, publishAt, caption, variants, mediaType, mediaUrls: mediaUrl ? [mediaUrl] : [], link }
  const editing = tab !== 'all' && platforms.includes(tab) ? tab : 'all' // a deselected platform's tab falls back
  const problems = validate(draft, true)
  const locked = post?.status === 'posting'
  const when = publishAt ? publishAt.slice(11, 16) : 'post time'

  function setVariant(p: Platform, key: keyof Variant, value: string) {
    setVariants((cur) => ({ ...cur, [p]: { ...cur[p], [key]: value } }))
  }

  function toggle(p: Platform) {
    setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]))
  }

  async function upload(file: File) {
    if (file.size > MAX_BYTES) return setError('Files over 50 MB are too big for the free plan; shrink it first')
    setBusy('upload')
    setError('')
    const { data: auth } = await supabase.auth.getUser()
    const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
    // Random name in the user's own folder: storage policies only allow that folder.
    const path = `${auth.user?.id}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from('media').upload(path, file, { contentType: file.type })
    setBusy('')
    if (error) return setError(error.message)
    setMediaUrl(supabase.storage.from('media').getPublicUrl(path).data.publicUrl)
    setMediaType(file.type.startsWith('video/') ? 'video' : 'image')
  }

  async function save(status: 'draft' | 'scheduled') {
    setTried(true)
    const errors = validate(draft, status === 'scheduled')
    if (errors.length || !account) return
    setBusy('save')
    const fields = {
      account_id: account.id,
      platforms,
      publish_at: publishAt ? zonedToUtc(publishAt, account.timezone) : null,
      caption,
      variants: cleanVariants(variants, platforms),
      media_type: mediaType,
      media_urls: mediaUrl ? [mediaUrl] : [],
      link,
      status,
      // Rescheduling starts a fresh retry budget; filled platform IDs still stop any repost.
      ...(status === 'scheduled' ? { attempts: 0, last_error: '', claimed_at: null } : {}),
    }
    const { error } = num
      ? await supabase.from('posts').update(fields).eq('num', num).neq('status', 'posting')
      : await supabase.from('posts').insert(fields)
    setBusy('')
    if (error) return setError(error.message)
    go('/')
  }

  async function remove() {
    if (!num || !confirm('Delete this post? This cannot be undone.')) return
    const { error } = await supabase.from('posts').delete().eq('num', num)
    if (error) return setError(error.message)
    go('/')
  }

  // Wait for accounts before choosing a screen, so the empty state never flashes on load.
  if (accounts === null) return null
  if (accounts.length === 0 && !error) {
    return (
      <section className="hero rise">
        <span className="eyebrow">First things first</span>
        <h1>Add an account</h1>
        <p>Posts belong to an account: your Facebook Page and Instagram, or just your phone for by-hand platforms.</p>
        <a className="btn primary" href="#/accounts" style={{ alignSelf: 'flex-start' }}>Add account<span className="knob"><Arrow /></span></a>
      </section>
    )
  }

  const plan = platforms.map((p) => {
    if (post && isDone(post, p)) return { p, text: 'Already done. It will not be posted again.' }
    if (p === 'facebook') return { p, text: link && mediaUrl ? 'Posted to your Page with the link in the caption.' : 'Posted to your Page.' }
    if (p === 'instagram') return { p, text: 'Posted as a single image. Retries up to 3 times if Instagram is busy.' }
    return { p, text: 'Sent to your phone with the caption ready to paste.' }
  })

  return (
    <>
      <header className="hero rise">
        <span className="eyebrow">{num ? `Post #${num}` : 'One post · every platform'}</span>
        <h1>{num ? 'Edit post' : 'Write it once'}</h1>
        <p>Pick where it goes. PostPilot checks it now, not at post time.</p>
      </header>

      {locked && <p className="notice" role="status">This post is being published right now. Edit it after the run finishes.</p>}
      {post?.last_error && <p className="notice" role="status">{post.last_error}</p>}
      {error && <p className="notice" role="alert">{error}</p>}

      <form className="split" onSubmit={(e) => { e.preventDefault(); save('scheduled') }}>
        <section className="main tray rise" aria-label="Post">
          <fieldset className="core" disabled={locked} style={{ gap: 28, border: 0, margin: 0, minWidth: 0 }}>
            <div className="field" style={{ gap: 12 }}>
              <div role="group" aria-label="Edit the text for" className="filters" style={{ alignSelf: 'flex-start', flexWrap: 'wrap', borderRadius: 22 }}>
                <button type="button" aria-pressed={editing === 'all'} onClick={() => setTab('all')}>All platforms</button>
                {platforms.map((p) => (
                  <button key={p} type="button" aria-pressed={editing === p} onClick={() => setTab(p)}>
                    {PLATFORM_NAMES[p]}{isCustomized(variants, p) && <span aria-label=" (customized)" style={{ color: 'var(--accent)' }}> ●</span>}
                  </button>
                ))}
              </div>
              {editing === 'all' ? (
                <>
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <label htmlFor="caption">Caption <span style={{ fontWeight: 400, color: 'var(--muted)' }}>· used everywhere unless a platform overrides it</span></label>
                    <span className="mono" aria-live="polite">{caption.length.toLocaleString('en')} chars · {hashtagCount(caption)} hashtags</span>
                  </span>
                  <textarea id="caption" className="input" value={caption} onChange={(e) => setCaption(e.target.value)} />
                </>
              ) : (
                <PlatformText p={editing} base={caption} variants={variants} set={setVariant} />
              )}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              <div className="field" style={{ flex: '1 1 280px', minWidth: 0 }}>
                <span className="legend">Media</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 12, borderRadius: 18, background: 'var(--well)', boxShadow: 'inset 0 0 0 1px var(--hair)' }}>
                  <span className="thumb" aria-hidden="true" style={mediaType === 'image' && mediaUrl ? { width: 64, height: 64, backgroundImage: `url("${mediaUrl}")`, color: 'transparent' } : { width: 64, height: 64 }}>
                    {mediaType === 'none' ? 'None' : mediaType}
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                    <label className="btn light file-btn" style={{ alignSelf: 'flex-start', minHeight: 44, paddingRight: 22 }}>
                      {mediaUrl ? 'Replace file' : 'Choose file'}
                      <input type="file" accept={ACCEPT} disabled={busy === 'upload'}
                        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                    </label>
                    <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                      {busy === 'upload' ? 'Uploading…' : mediaUrl ? 'Uploaded.' : 'JPG, PNG, WebP, MP4 or MOV, up to 50 MB'}
                    </span>
                    {mediaUrl && (
                      <button type="button" onClick={() => { setMediaUrl(''); setMediaType('none') }}
                        style={{ alignSelf: 'flex-start', minHeight: 44, padding: 0, border: 0, background: 'none', color: 'var(--accent-ink)', fontSize: 14, cursor: 'pointer' }}>
                        Remove media
                      </button>
                    )}
                  </span>
                </div>
              </div>
              <div style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="field">
                  <label htmlFor="account">Account</label>
                  <select id="account" className="input" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="when">Post at <span style={{ fontWeight: 400, color: 'var(--muted)' }}>· {account?.timezone}</span></label>
                  <input id="when" className="input" type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="link">Link <span style={{ fontWeight: 400, color: 'var(--muted)' }}>· Facebook only</span></label>
                  <input id="link" className="input" type="url" inputMode="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
                </div>
              </div>
            </div>

            <fieldset style={{ margin: 0, padding: 0, border: 0 }}>
              <legend className="legend" style={{ padding: 0, marginBottom: 12 }}>Platforms</legend>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
                {PLATFORMS.map((p) => {
                  const on = platforms.includes(p)
                  return (
                    <label key={p} className="tile">
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontSize: 15, fontWeight: 500 }}>{PLATFORM_NAMES[p]}</span>
                        <input type="checkbox" checked={on} onChange={() => toggle(p)} style={{ width: 20, height: 20, accentColor: 'var(--ink)' }} />
                      </span>
                      <span className="mono" style={{ alignSelf: 'flex-start', padding: '4px 8px', borderRadius: 999, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
                        background: isAssisted(p) ? 'var(--accent-tint)' : '#e9eae5', color: isAssisted(p) ? 'var(--accent-ink)' : 'var(--ink)' }}>
                        {isAssisted(p) ? 'By hand' : 'Automatic'}
                      </span>
                    </label>
                  )
                })}
              </div>
            </fieldset>

            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 12 }}>
              {num && post && !post.fb_post_id && !post.ig_media_id && (
                <button type="button" className="btn" onClick={remove} style={{ marginRight: 'auto' }}>Delete</button>
              )}
              <button type="button" className="btn" disabled={busy !== ''} onClick={() => save('draft')}>Save draft</button>
              <button type="submit" className="btn primary" disabled={busy !== ''}>
                {busy === 'save' ? 'Saving…' : publishAt ? `Schedule for ${when}` : 'Schedule'}<span className="knob"><Arrow /></span>
              </button>
            </div>
          </fieldset>
        </section>

        <aside className="side" aria-label="Checks and plan">
          <section className="tray rise">
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
          {platforms.length > 0 && (
            <section className="tray rise">
              <div className="core dark">
                <span className="eyebrow" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff' }}>At {when}</span>
                <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {plan.map(({ p, text }, i) => (
                    <li key={p} style={{ display: 'flex', gap: 16, padding: '14px 0', borderTop: i ? '1px solid rgba(255,255,255,0.08)' : 0 }}>
                      <span className="mono" style={{ width: 32, lineHeight: '20px', color: isAssisted(p) ? '#afc0ff' : '#c9cbcf' }}>{PLATFORM_CODES[p]}</span>
                      <span style={{ fontSize: 14, lineHeight: 1.45 }}>{text}</span>
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
          <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <label htmlFor="v-title">YouTube title</label>
            <span className="mono">{(v.title ?? '').length} / {YOUTUBE_TITLE_MAX}</span>
          </span>
          <input id="v-title" className="input" maxLength={YOUTUBE_TITLE_MAX + 20} value={v.title ?? ''} onChange={(e) => set(p, 'title', e.target.value)} />
        </div>
      )}
      <div className="field">
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
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
        <button type="button" onClick={() => { set(p, 'caption', ''); set(p, 'hashtags', ''); set(p, 'title', '') }}
          style={{ alignSelf: 'flex-start', minHeight: 44, padding: 0, border: 0, background: 'none', color: 'var(--accent-ink)', fontSize: 14, cursor: 'pointer' }}>
          Use the main caption for {PLATFORM_NAMES[p]}
        </button>
      )}
    </div>
  )
}
