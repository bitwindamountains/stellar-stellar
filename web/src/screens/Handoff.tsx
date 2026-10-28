import { useEffect, useState } from 'react'
import { textFor, titleFor, type Variants } from '../content'
import { Check, FlightPath, Logo } from '../icons'
import { go } from '../route'
import { supabase } from '../supabase'
import { ACCOUNT_SELECT, isDone, isDraft, needsFinishing, sentByHand, PLATFORM_NAMES, type Account, type Platform, type Post } from '../types'

const OPEN_URL: Partial<Record<Platform, string>> = {
  tiktok: 'https://www.tiktok.com/upload',
  youtube: 'https://studio.youtube.com',
  fb_profile: 'https://www.facebook.com',
  shopee: 'https://shopee.ph',
}

export default function Handoff({ num }: { num: number }) {
  const [post, setPost] = useState<(Post & { account?: Account }) | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('') // which copy button last succeeded
  const [sharing, setSharing] = useState(false)
  const [swapping, setSwapping] = useState('')

  useEffect(() => {
    supabase.from('posts').select(`*, account:accounts(${ACCOUNT_SELECT})`).eq('num', num).single().then(({ data, error }) => {
      if (error) setError(error.message)
      else setPost(data as Post)
    })
  }, [num])

  if (error) return <Frame><p className="notice" role="alert">{error}</p></Frame>
  if (!post) return <Frame />

  const targets = post.platforms.filter((p) => needsFinishing(post, p, post.account))
  // A draft already has its video in TikTok: only by-hand platforms need the file shared.
  const shareNeeded = targets.some((p) => !isDraft(post, p))
  const media = post.media_urls[0]
  const variants = (post.variants ?? {}) as Variants
  // Same text the publisher sends to Telegram: the platform's own caption, plus the link for your profile.
  const textOf = (p: Platform) => [textFor(post.caption, variants, p), p === 'fb_profile' ? post.link : ''].filter(Boolean).join('\n\n')
  const text = targets.length ? textOf(targets[0]) : post.caption
  const names = targets.map((p) => PLATFORM_NAMES[p]).join(' and ')

  async function shareMedia() {
    if (!media) return
    setSharing(true)
    try {
      const blob = await (await fetch(media)).blob()
      const file = new File([blob], media.split('/').pop() || 'post', { type: blob.type })
      // The phone's share sheet sends the file straight into TikTok, YouTube or Facebook.
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text })
      else window.open(media, '_blank', 'noopener')
    } catch {
      window.open(media, '_blank', 'noopener') // share cancelled or unsupported: let them save it from the tab
    } finally {
      setSharing(false)
    }
  }

  async function copy(key: string, value: string) {
    let result = key
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      result = `${key}:failed` // no clipboard permission (or not https): say so instead of failing silently
    }
    // Blur bridges the label swap so it reads as one change, not two overlapping words.
    setSwapping(key)
    setTimeout(() => { setCopied(result); setSwapping('') }, 90)
    // Revert so a second tap visibly copies again.
    setTimeout(() => setCopied((c) => (c === result ? '' : c)), 1800)
  }

  const copyButton = (key: string, label: string, value: string) => (
    <button type="button" className="step" onClick={() => copy(key, value)}>
      <span className={`swap${swapping === key ? ' swapping' : ''}`} style={{ flex: 1 }}>{copied === key ? 'Copied' : copied === `${key}:failed` ? "Couldn't copy: select the text above" : label}</span>
      {copied === key && <Check />}
    </button>
  )

  async function done() {
    // Free-plan storage is 1 GB: once nothing else needs the upload, remove it. Pasted outside links are left alone.
    const automaticPending = post!.platforms.some((p) => !sentByHand(post!, p, post!.account) && !isDone(post!, p))
    const prefix = supabase.storage.from('media').getPublicUrl('').data.publicUrl
    let removed = automaticPending ? [] : post!.media_urls.filter((u) => u.startsWith(prefix))
    if (removed.length) {
      // Delete first; only forget the links if that worked, so a failed delete leaves a findable file.
      const { error } = await supabase.storage.from('media').remove(removed.map((u) => u.slice(prefix.length).replace(/^\//, '')))
      if (error) removed = []
    }
    // Drop removed links from the post, so nothing (like Post again) reuses a dead URL.
    const { error } = await supabase
      .from('posts')
      .update({ assist_done_at: new Date().toISOString(), media_urls: post!.media_urls.filter((u) => !removed.includes(u)) })
      .eq('num', num)
    if (error) return setError(error.message)
    go('/')
  }


  return (
    <Frame>
      <header className="sky compact" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 24, borderRadius: 28 }}>
        <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.02, fontWeight: 600, letterSpacing: '-0.035em' }}>Post to {names || 'your apps'}</h1>
        <p style={{ margin: 0, fontSize: 15, color: post.assist_done_at ? 'var(--accent-ink)' : 'var(--muted)' }}>
          {post.assist_done_at ? 'Marked as posted.' : 'Share it from your phone, then tap I posted it.'}
        </p>
        <FlightPath />
      </header>

      <div className="tray">
        <div className="core flush">
          {media && post.media_type === 'video' && <video src={media} controls playsInline style={{ width: '100%', maxHeight: 280, background: '#1e2026', display: 'block' }} />}
          {media && post.media_type === 'image' && <img src={media} alt="" style={{ width: '100%', maxHeight: 280, objectFit: 'cover', display: 'block' }} />}
          <p style={{ margin: 0, padding: '16px 18px 18px', fontSize: 15, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{text || 'No caption'}</p>
        </div>
      </div>

      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {media && shareNeeded && <li><button type="button" className="step" onClick={shareMedia} disabled={sharing}>{sharing ? 'Preparing…' : `Share ${post.media_type}`}</button></li>}
        {targets.map((p) => (
          <li key={p} style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8 }}>
            <span className="mono" style={{ paddingLeft: 4 }}>{PLATFORM_NAMES[p].toUpperCase()}</span>
            {isDraft(post, p) && <p style={{ margin: 0, paddingLeft: 4, fontSize: 14, color: 'var(--muted)' }}>
              The video is in your TikTok inbox. Open TikTok, tap the notification, paste the caption and post.</p>}
            {titleFor(variants, p) && copyButton(`${p}-title`, 'Copy title', titleFor(variants, p))}
            {textOf(p) && copyButton(`${p}-text`, 'Copy caption', textOf(p))}
            {OPEN_URL[p] && <a href={isDraft(post, p) ? 'https://www.tiktok.com/' : OPEN_URL[p]} target="_blank" rel="noopener" className="step">Open {PLATFORM_NAMES[p]}</a>}
          </li>
        ))}
      </ol>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button type="button" className="btn primary" onClick={done} disabled={!!post.assist_done_at}
          style={{ justifyContent: 'space-between', minHeight: 60, paddingLeft: 24, paddingRight: 8, fontSize: 16 }}>
          {post.assist_done_at ? 'Marked as posted' : 'I posted it'}<span className="knob" style={{ width: 44, height: 44 }}><Check /></span>
        </button>
        <a href="#/" className="btn" style={{ background: 'transparent' }}>Back to queue</a>
      </div>
    </Frame>
  )
}

function Frame({ children }: { children?: React.ReactNode }) {
  return (
    <main className="page" style={{ display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: 'min(480px, 100%)', minHeight: 'calc(100dvh - 48px)', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 15 }}><Logo />PostPilot</span>
        {children}
      </div>
    </main>
  )
}
