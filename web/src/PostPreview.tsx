import { useState } from 'react'
import type { Variants } from './content'
import { previewText } from './preview'
import { byHand, PLATFORM_NAMES, type MediaType, type Platform } from './types'

// Rough crops per platform: Instagram feed 4:5, X 16:9, TikTok/YouTube Shorts 9:16; Facebook keeps the shape.
const ASPECT: Partial<Record<Platform, string>> = { instagram: '4 / 5', x: '16 / 9', tiktok: '9 / 16', youtube: '16 / 9' }

/** A mock of the post on each platform, from the same text the publisher sends. */
export default function PostPreview({ platforms, caption, variants, link, mediaType, mediaUrl, accountFor }: {
  platforms: Platform[]
  caption: string
  variants: Variants
  link: string
  mediaType: MediaType
  mediaUrl: string
  accountFor: (p: Platform) => string
}) {
  const [picked, setPicked] = useState<Platform>(platforms[0])
  const p = platforms.includes(picked) ? picked : platforms[0]
  const view = previewText(p, { caption, variants, link })
  const hand = byHand(p, undefined) && p !== 'tiktok'
  return (
    <section className="tray rise" aria-label="Preview">
      <div className="core">
        <h2>Preview</h2>
        <div role="group" aria-label="Preview for" className="filters" style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
          {platforms.map((x) => (
            <button key={x} type="button" aria-pressed={x === p} onClick={() => setPicked(x)}>{PLATFORM_NAMES[x]}</button>
          ))}
        </div>
        <article className="preview">
          <header className="preview-head">
            <span className="preview-avatar" aria-hidden="true">{(accountFor(p) || '?')[0].toUpperCase()}</span>
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <strong style={{ fontSize: 14 }}>{accountFor(p)}</strong>
              <span className="mono">{PLATFORM_NAMES[p]}</span>
            </span>
          </header>
          {mediaUrl && mediaType === 'image' && (
            <img src={mediaUrl} alt="" className="preview-media" style={{ aspectRatio: ASPECT[p] ?? 'auto' }} />
          )}
          {mediaUrl && mediaType === 'video' && (
            <video src={mediaUrl} muted playsInline preload="metadata" className="preview-media" style={{ aspectRatio: ASPECT[p] ?? 'auto' }} />
          )}
          <div className="preview-body">
            {view.title && <strong style={{ fontSize: 15 }}>{view.title}</strong>}
            <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {view.text || <span style={{ color: 'var(--muted)' }}>No caption</span>}
              {view.more && <span style={{ color: 'var(--muted)' }}>… more</span>}
            </p>
            {view.count && (
              <span className="mono" style={{ color: view.count.used > view.count.max ? 'var(--warn-ink)' : undefined }}>
                {view.count.used} / {view.count.max}
              </span>
            )}
          </div>
        </article>
        {hand && <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>You post this one by hand; this is the text you'll paste.</p>}
      </div>
    </section>
  )
}
