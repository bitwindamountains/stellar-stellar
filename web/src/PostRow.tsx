import type { CSSProperties } from 'react'
import { groupHref, groupStatus, postLinks, type PostGroup } from './groups'
import { Check, PlatformMark } from './icons'
import { chips, flightStep } from './postView'
import { utcToZoned } from './time'
import type { Account } from './types'

const NAMED = { facebook: 'Facebook', instagram: 'Instagram', x: 'X', tiktok: 'TikTok' } as Record<string, string>

/** One post (or one multi-account group) in a list: time, picture, caption, where it goes, status, live links. */
export default function PostRow({ group: g, accountOf, tz, href }: {
  group: PostGroup
  accountOf: (id: number) => Account | undefined
  tz: string
  href?: string
}) {
  const lead = g.lead
  const status = groupStatus(g.rows)
  const image = lead.media_type === 'image' ? lead.media_urls[0] : undefined
  const multi = g.rows.length > 1
  const done = g.rows.flatMap(chips).filter((c) => c.state === 'done')
  const links = g.rows.flatMap((r) => postLinks(r).map((l) => ({ ...l, who: accountOf(r.account_id)?.name ?? '' })))
  // In flight: being posted now, or due and waiting for the run that picks it up.
  const due = g.rows.some((r) => r.status === 'posting'
    || (['scheduled', 'partial'].includes(r.status) && !!r.publish_at && Date.parse(r.publish_at) <= Date.now()))
  const step = due ? flightStep(g) : null

  return (
    <li>
      <a className="row" href={href ?? groupHref(g.rows)}>
        <span className="r-time">{lead.publish_at ? utcToZoned(lead.publish_at, tz).slice(11, 16) : '--:--'}</span>
        <span className="thumb r-thumb" aria-hidden="true" style={image ? { backgroundImage: `url("${image}")`, color: 'transparent' } : undefined}>
          {lead.media_type === 'none' ? (lead.link ? 'Link' : 'Text') : lead.media_type}
          {/* one moon per platform it has gone out on (the chips carry the same facts for screen readers) */}
          {done.length > 0 && (
            <span className="orbit">
              {done.map((c, i) => (
                <span key={`${i}-${c.platform}`} className="moon" style={{ '--a': `${(i * 360) / done.length - 45}deg` } as CSSProperties}>
                  <PlatformMark platform={c.platform} />
                </span>
              ))}
            </span>
          )}
        </span>
        <span className="r-body">
          <span className="r-caption">{lead.caption || <span style={{ color: 'var(--muted)' }}>No caption</span>}</span>
          <span className="r-chips">
            {g.rows.map((r) => (
              <span key={r.num} style={{ display: 'contents' }}>
                {multi && <span className="mono" style={{ marginLeft: r === lead ? 0 : 6 }}>{accountOf(r.account_id)?.name}</span>}
                {chips(r).map((c) => (
                  <span key={c.platform} className={`chip ${c.state}`} title={c.label} aria-label={c.label}>{c.code}</span>
                ))}
              </span>
            ))}
          </span>
          {step && (
            <span className="r-step" aria-live="polite">
              {step === 'Posted' ? <><Check />Posted</> : step === 'Posting…' ? <><span className="pulse" aria-hidden="true" />{step}</> : `${step} · usually within an hour`}
            </span>
          )}
        </span>
        <span className={`pill r-pill ${status.tone}`}>{status.text}</span>
      </a>
      {links.length > 0 && (
        <div className="r-links">
          {links.map((l) => (
            <a key={`${l.who}-${l.platform}`} href={l.url} target="_blank" rel="noopener">
              Open on {NAMED[l.platform]}{multi ? ` · ${l.who}` : ''}<span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span>
            </a>
          ))}
        </div>
      )}
    </li>
  )
}
