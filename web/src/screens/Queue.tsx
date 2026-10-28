import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { retryNow } from '../actions'
import { Arrow, Asteroids, Constellation, FlightPath, PlatformMark } from '../icons'
import { awaitingHandoff, canRetry, chips, groupByDay, mergePosts, needsYou, statusLabel, timeOf, weekStrip } from '../postView'
import { supabase } from '../supabase'
import { ACCOUNT_SELECT, PLATFORM_CODES, sentByHand, type Account, type Post, type Run } from '../types'

type Filter = 'all' | 'auto' | 'hand' | 'needs'

export default function Queue() {
  const [posts, setPosts] = useState<Post[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [run, setRun] = useState<Run | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [retrying, setRetrying] = useState<number | null>(null)

  const load = useCallback(() => {
    // Last 2 days onward, plus undated drafts. ponytail: no paging; fine for a personal queue of a few hundred.
    const since = new Date(Date.now() - 2 * 86_400_000).toISOString()
    Promise.all([
      supabase.from('posts').select('*').or(`publish_at.gte.${since},publish_at.is.null`).order('publish_at').limit(300),
      supabase.from('accounts').select(ACCOUNT_SELECT).order('name'),
      supabase.from('runs').select('*').order('ran_at', { ascending: false }).limit(1),
      // Unresolved posts stay visible however old, so a failure can't quietly drop out of "Needs you".
      // Newest first up to 1,000 (Supabase's default row cap); a personal queue won't get near that.
      supabase.from('posts').select('*').in('status', ['failed', 'missed', 'partial', 'posting'])
        .order('publish_at', { ascending: false }).limit(1000),
      supabase.from('posts').select('*').neq('tg_message_id', '').is('assist_done_at', null)
        .order('publish_at', { ascending: false }).limit(1000),
    ]).then(([p, a, r, unresolved, handoffs]) => {
      const failed = p.error ?? a.error ?? r.error ?? unresolved.error ?? handoffs.error
      if (failed) setError(failed.message)
      setPosts(mergePosts(p.data, unresolved.data, handoffs.data))
      setAccounts((a.data as Account[]) ?? [])
      setRun(((r.data as Run[]) ?? [])[0] ?? null)
      setLoaded(true)
    })
  }, [])
  useEffect(load, [load])

  async function retry(num: number) {
    setRetrying(num)
    const failed = await retryNow(num)
    setRetrying(null)
    if (failed) setError(failed)
    else load()
  }

  const shown = useMemo(() => {
    const accountOf = (p: Post) => accounts.find((a) => a.id === p.account_id)
    const keep: Record<Filter, (p: Post) => boolean> = {
      all: () => true,
      auto: (p) => p.platforms.some((x) => !sentByHand(p, x, accountOf(p))),
      hand: (p) => p.platforms.some((x) => sentByHand(p, x, accountOf(p))),
      needs: needsYou,
    }
    return posts.filter(keep[filter])
  }, [posts, filter, accounts])
  const attention = posts.filter(needsYou)
  const days = groupByDay(shown)

  return (
    <>
      <header className={`hero sky rise${attention.length ? ' alert' : ''}`} style={{ maxWidth: 'none', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 32 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 720 }}>
          <h1>Your queue</h1>
          <p>Facebook and Instagram post themselves. TikTok, YouTube and your personal profile come to your phone ready to share.</p>
        </div>
        <div role="group" aria-label="Filter posts" className="filters">
          {([['all', 'All'], ['auto', 'Automatic'], ['hand', 'By hand'], ['needs', `Needs you · ${attention.length}`]] as const).map(([key, label]) => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>
          ))}
        </div>
        <FlightPath />
        <Asteroids />
      </header>

      {error && <p className="notice" role="alert">Couldn't load everything: {error}</p>}

      {loaded && (
        <nav aria-label="Next 7 days" className="week rise">
          {weekStrip(posts).map((day) => {
            const inner = (
              <>
                <span className="mono">{day.label.toUpperCase()}</span>
                <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>{day.date}</span>
                <span style={{ fontSize: 12, color: day.count ? 'var(--ink-2)' : 'var(--warn-ink)' }}>
                  {day.count ? `${day.count} post${day.count === 1 ? '' : 's'}` : 'Nothing yet'}
                </span>
              </>
            )
            return day.count ? (
              <div key={day.key} className="week-day">{inner}</div>
            ) : (
              <a key={day.key} href="#/new" className="week-day empty-day" aria-label={`${day.label} ${day.date}: nothing planned, write a post`}>{inner}</a>
            )
          })}
        </nav>
      )}

      <div className="split">
        <section className="main tray rise" aria-label="Posts">
          <div className="core flush" aria-busy={!loaded}>
            {!loaded && [0, 1, 2].map((i) => <div key={i} className="skeleton" aria-hidden="true" />)}
            {loaded && days.length === 0 && (
              <div className="empty">
                {filter === 'all' ? <><Constellation /><p>Nothing planned yet. <a href="#/new">Write your first post</a>.</p></> : <p>Nothing here.</p>}
              </div>
            )}
            {days.map((day) => (
              <div key={day.label + day.date}>
                <div className="day"><h2>{day.label}</h2><span className="mono">{day.date}</span></div>
                <ul className="rows">
                  {day.posts.map((post) => {
                    const status = statusLabel(post)
                    const image = post.media_type === 'image' ? post.media_urls[0] : undefined
                    const rowChips = chips(post)
                    const done = rowChips.filter((c) => c.state === 'done')
                    return (
                      <li key={post.num}>
                        <a className="row" href={awaitingHandoff(post) ? `#/handoff/${post.num}` : `#/edit/${post.num}`}>
                          <span className="r-time">{timeOf(post.publish_at)}</span>
                          <span className="thumb r-thumb" aria-hidden="true" style={image ? { backgroundImage: `url("${image}")`, color: 'transparent' } : undefined}>
                            {post.media_type === 'none' ? (post.link ? 'Link' : 'Text') : post.media_type}
                            {/* one moon per platform it has gone out on (the chips carry the same facts for screen readers) */}
                            {done.length > 0 && (
                              <span className="orbit">
                                {done.map((c, i) => (
                                  <span key={c.platform} className="moon" style={{ '--a': `${(i * 360) / done.length - 45}deg` } as CSSProperties}>
                                    <PlatformMark platform={c.platform} />
                                  </span>
                                ))}
                              </span>
                            )}
                          </span>
                          <span className="r-body">
                            <span style={{ fontSize: 15, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                              {post.caption || <span style={{ color: 'var(--muted)' }}>No caption</span>}
                            </span>
                            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {rowChips.map((c) => (
                                <span key={c.platform} className={`chip ${c.state}`} title={c.label} aria-label={c.label}>{c.code}</span>
                              ))}
                            </span>
                          </span>
                          <span className={`pill r-pill ${status.tone}`}>{status.text}</span>
                        </a>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <aside className="side" aria-label="Status">
          <section className="tray rise">
            <div className="core dark">
              <h2 style={{ fontSize: 24, letterSpacing: '-0.02em' }}>
                {attention.length === 0 ? 'All clear' : `${attention.length} thing${attention.length === 1 ? '' : 's'} to check`}
              </h2>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: '#c9cbcf' }}>
                Nothing gets posted twice. When PostPilot isn't sure, it stops and asks.
              </p>
              {attention.slice(0, 3).map((post) => (
                <div key={post.num} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: 18,
                  background: 'rgba(255,255,255,0.06)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}>
                  <a href={awaitingHandoff(post) ? `#/handoff/${post.num}` : `#/edit/${post.num}`}
                    style={{ display: 'flex', flexDirection: 'column', gap: 6, textDecoration: 'none' }}>
                    <span className="mono" style={{ color: awaitingHandoff(post) ? '#afc0ff' : '#f5b583' }}>
                      {post.platforms.map((p) => PLATFORM_CODES[p]).join(' · ')} · {timeOf(post.publish_at)}
                    </span>
                    <span style={{ fontSize: 14, lineHeight: 1.45 }}>
                      {awaitingHandoff(post) ? 'Waiting for you to post by hand.' : post.last_error || 'Check this post.'}
                    </span>
                  </a>
                  {canRetry(post) && (
                    <button type="button" className="btn light" onClick={() => retry(post.num)} disabled={retrying === post.num}
                      style={{ alignSelf: 'flex-start', minHeight: 40, padding: '0 16px', fontSize: 13 }}>
                      {retrying === post.num ? 'Retrying…' : 'Retry now'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="tray rise">
            <div className="core">
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                <h2>Last run</h2>
                {run && <span className="mono">{timeOf(run.ran_at)} · {(run.duration_ms / 1000).toFixed(0)} s</span>}
              </div>
              {run ? (
                <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                  {([['Posted', run.posted], ['Retrying', run.partial], ['Failed', run.failed + run.missed]] as const).map(([k, v]) => (
                    <div key={k} style={{ padding: 14, borderRadius: 16, background: 'var(--well)' }}>
                      <dt style={{ fontSize: 12, color: 'var(--muted)' }}>{k}</dt>
                      <dd style={{ margin: '6px 0 0', fontSize: 28, fontWeight: 600, letterSpacing: '-0.03em' }}>{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>No runs yet. The publisher runs every 30 minutes once it's set up.</p>
              )}
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
                Runs at :07 and :37. Posts go out within about half an hour of their time.
              </p>
            </div>
          </section>

          <section className="tray rise">
            <div className="core">
              <h2>Accounts</h2>
              {accounts.length === 0 ? (
                <a className="btn light" href="#/accounts" style={{ alignSelf: 'flex-start' }}>Add an account<span className="knob"><Arrow /></span></a>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
                  {accounts.map((a) => (
                    <li key={a.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <span>{a.name}</span>
                      <span className="mono">{[a.fb_page_id && 'FB', a.ig_user_id && 'IG'].filter(Boolean).join(' · ') || 'by hand only'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </aside>
      </div>
    </>
  )
}
