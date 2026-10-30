import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { retryNow } from '../actions'
import { groupHref, groupPosts, groupStatus, postLinks, type PostGroup } from '../groups'
import { Arrow, Asteroids, Check, Constellation, FlightPath, PlatformMark } from '../icons'
import { ago, awaitingHandoff, canRetry, chips, groupByDay, mergePosts, needsYou, statsLine, timeOf, weekStrip } from '../postView'
import { reveal } from '../scroll'
import { supabase } from '../supabase'
import { ACCOUNT_SELECT, canPost, isConnected, needsFinishing, PLATFORM_CODES, sentByHand, type Account, type PlatformStats, type Post, type Run } from '../types'

type Filter = 'all' | 'auto' | 'hand' | 'needs' | 'posted'
const NAMED = { facebook: 'Facebook', instagram: 'Instagram', x: 'X', tiktok: 'TikTok' } as Record<string, string>
const RECENT_MS = 15 * 60_000 // a post stays in "Going out" this long after it posted

/** Local calendar date as YYYY-MM-DD (day anchors and the composer's ?date=). */
function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Due or posting now, or posted in the last few minutes: what "Post now" is waiting on. */
function inFlight(g: PostGroup, now: number): boolean {
  return g.rows.some((r) => r.status === 'posting'
    || (['scheduled', 'partial'].includes(r.status) && !!r.publish_at && new Date(r.publish_at).getTime() <= now)
    || (r.status === 'posted' && !!r.posted_at && now - new Date(r.posted_at).getTime() < RECENT_MS))
}

function flightStep(g: PostGroup): string {
  if (g.rows.some((r) => r.status === 'posting')) return 'Posting…'
  if (g.rows.some((r) => ['scheduled', 'partial'].includes(r.status))) return 'Waiting for the next run'
  return 'Posted'
}

export default function Queue() {
  const [posts, setPosts] = useState<Post[]>([])
  const [history, setHistory] = useState<Post[] | null>(null) // results for the Posted tab or a search
  const [accounts, setAccounts] = useState<Account[]>([])
  const [run, setRun] = useState<Run | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
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
      setError(failed ? failed.message : '')
      setPosts(mergePosts(p.data, unresolved.data, handoffs.data))
      setAccounts((a.data as Account[]) ?? [])
      setRun(((r.data as Run[]) ?? [])[0] ?? null)
      setLoaded(true)
    })
  }, [])
  useEffect(load, [load])

  // Live: reload shortly after any post or run changes (Realtime), and when the app comes back to the front.
  useEffect(() => {
    let timer = 0
    const soon = () => { clearTimeout(timer); timer = window.setTimeout(load, 400) }
    const channel = supabase.channel('queue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, soon)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'runs' }, soon)
      .subscribe()
    const onShow = () => { if (document.visibilityState === 'visible') soon() }
    document.addEventListener('visibilitychange', onShow)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onShow); supabase.removeChannel(channel) }
  }, [load])

  // Posted tab and search look further back than the live queue, straight from the database.
  const query = search.trim().replace(/[%_\\]/g, '')
  useEffect(() => {
    if (filter !== 'posted' && !query) return setHistory(null)
    let q = supabase.from('posts').select('*').order('publish_at', { ascending: false }).limit(200)
    if (filter === 'posted') q = q.eq('status', 'posted')
    if (query) q = q.ilike('caption', `%${query}%`)
    let current = true
    const timer = setTimeout(() => q.then(({ data, error }) => {
      if (!current) return
      if (error) setError(error.message)
      setHistory((data as Post[]) ?? [])
    }), query ? 300 : 0)
    return () => { current = false; clearTimeout(timer) }
  }, [filter, query, posts])

  async function retry(num: number) {
    setRetrying(num)
    const failed = await retryNow(num)
    setRetrying(null)
    if (failed) setError(failed)
    else load()
  }

  const accountOf = useCallback((id: number) => accounts.find((a) => a.id === id), [accounts])
  const groups = useMemo(() => groupPosts(history ?? posts), [history, posts])
  const shown = useMemo(() => {
    const keep: Record<Filter, (p: Post) => boolean> = {
      all: () => true,
      auto: (p) => p.platforms.some((x) => !sentByHand(p, x, accountOf(p.account_id))),
      hand: (p) => p.platforms.some((x) => needsFinishing(p, x, accountOf(p.account_id))),
      needs: needsYou,
      posted: () => true,
    }
    return groups.filter((g) => g.rows.some(keep[filter]))
  }, [groups, filter, accountOf])
  const attention = posts.filter(needsYou)
  const allGroups = useMemo(() => groupPosts(posts), [posts])
  const flying = allGroups.filter((g) => inFlight(g, Date.now()))
  const byLead = new Map(shown.map((g) => [g.lead.num, g]))
  let days = groupByDay(shown.map((g) => g.lead))
  if (history) days = days.reverse().map((d) => ({ ...d, posts: [...d.posts].reverse() })) // newest first

  return (
    <>
      <header className={`hero sky rise${attention.length ? ' alert' : ''}`} style={{ maxWidth: 'none', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 32 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 720 }}>
          <h1>Your queue</h1>
          <p>Facebook, Instagram and X post themselves, and TikTok lands in your drafts. Your profile, YouTube and Shopee come to your phone ready to share.</p>
        </div>
        <div role="group" aria-label="Filter posts" className="filters">
          {([['all', 'All'], ['auto', 'Automatic'], ['hand', 'By hand'], ['needs', `Needs you · ${attention.length}`], ['posted', 'Posted']] as const).map(([key, label]) => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>
          ))}
        </div>
        <FlightPath />
        <Asteroids />
      </header>

      {error && <p className="notice" role="alert">Couldn't load everything: {error}</p>}

      {loaded && (
        <nav aria-label="Next 7 days" className="week rise">
          {weekStrip(allGroups.map((g) => g.lead)).map((day) => {
            const date = localDate(new Date(day.key))
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
              <button key={day.key} type="button" className="week-day" aria-label={`${day.label} ${day.date}: ${day.count} planned, show them`}
                onClick={() => { setFilter('all'); setSearch(''); requestAnimationFrame(() => reveal(`day-${date}`)) }}>
                {inner}
              </button>
            ) : (
              <a key={day.key} href={`#/new?date=${date}`} className="week-day empty-day" aria-label={`${day.label} ${day.date}: nothing planned, write a post for that day`}>{inner}</a>
            )
          })}
        </nav>
      )}

      <div className="split">
        <section className="main tray rise" aria-label="Posts">
          <div className="core flush" aria-busy={!loaded}>
            <div style={{ padding: '20px 20px 0' }}>
              <label htmlFor="q" className="sr-only">Search captions</label>
              <input id="q" className="input search" type="search" placeholder="Search captions, any date" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {!loaded && [0, 1, 2].map((i) => <div key={i} className="skeleton" aria-hidden="true" />)}
            {loaded && days.length === 0 && (
              <div className="empty">
                {filter === 'all' && !query ? <><Constellation /><p>Nothing planned yet. <a href="#/new">Write your first post</a>.</p></> : <p>{history === null && (filter === 'posted' || query) ? 'Searching…' : 'Nothing here.'}</p>}
              </div>
            )}
            {days.map((day) => (
              <div key={day.label + day.date} id={day.posts[0].publish_at ? `day-${localDate(new Date(day.posts[0].publish_at))}` : undefined} style={{ scrollMarginTop: 96 }}>
                <div className="day"><h2>{day.label}</h2><span className="mono">{day.date}</span></div>
                <ul className="rows">
                  {day.posts.map((leadPost) => {
                    const g = byLead.get(leadPost.num)!
                    const status = groupStatus(g.rows)
                    const image = leadPost.media_type === 'image' ? leadPost.media_urls[0] : undefined
                    const multi = g.rows.length > 1
                    const done = g.rows.flatMap(chips).filter((c) => c.state === 'done')
                    const links = g.rows.flatMap((r) => postLinks(r).map((l) => ({ ...l, who: accountOf(r.account_id)?.name ?? '' })))
                    return (
                      <li key={g.key}>
                        <a className="row" href={groupHref(g.rows)}>
                          <span className="r-time">{timeOf(leadPost.publish_at)}</span>
                          <span className="thumb r-thumb" aria-hidden="true" style={image ? { backgroundImage: `url("${image}")`, color: 'transparent' } : undefined}>
                            {leadPost.media_type === 'none' ? (leadPost.link ? 'Link' : 'Text') : leadPost.media_type}
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
                            <span style={{ fontSize: 15, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                              {leadPost.caption || <span style={{ color: 'var(--muted)' }}>No caption</span>}
                            </span>
                            <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                              {g.rows.map((r) => (
                                <span key={r.num} style={{ display: 'contents' }}>
                                  {multi && <span className="mono" style={{ marginLeft: r === g.lead ? 0 : 6 }}>{accountOf(r.account_id)?.name}</span>}
                                  {chips(r).map((c) => (
                                    <span key={c.platform} className={`chip ${c.state}`} title={c.label} aria-label={c.label}>{c.code}</span>
                                  ))}
                                </span>
                              ))}
                            </span>
                          </span>
                          <span className={`pill r-pill ${status.tone}`}>{status.text}</span>
                        </a>
                        {links.length > 0 && (
                          <div className="r-links">
                            {links.map((l) => (
                              <a key={`${l.who}-${l.platform}`} href={l.url} target="_blank" rel="noopener">Open on {NAMED[l.platform]}{multi ? ` · ${l.who}` : ''}<NewTab /></a>
                            ))}
                          </div>
                        )}
                        {filter === 'posted' && g.rows.map((r) => {
                          const who = multi ? `${accountOf(r.account_id)?.name ?? ''} · ` : ''
                          const note = r.status === 'posted' ? r.last_error : null
                          const shown = (Object.entries(r.stats ?? {}) as [string, PlatformStats][]).filter(([, s]) => statsLine(s) || s.top_comments?.length)
                          if (!note && shown.length === 0) return null
                          return (
                            <div key={r.num} className="r-stats">
                              {shown.map(([platform, s]) => (
                                <div key={platform}>
                                  {statsLine(s) && <p className="mono">{who}{NAMED[platform]} · {statsLine(s)} · as of {ago(s.as_of)}</p>}
                                  {!!s.top_comments?.length && (
                                    <details>
                                      <summary>Top comments ({s.top_comments.length})</summary>
                                      <ul>
                                        {s.top_comments.slice(0, 5).map((c, i) => (
                                          <li key={i}><strong>{c.author}</strong> {c.text} <span className="mono">♥ {c.likes}</span></li>
                                        ))}
                                      </ul>
                                    </details>
                                  )}
                                </div>
                              ))}
                              {note && <p className="r-note">{who}{note}</p>}
                            </div>
                          )
                        })}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <aside className="side queue-side" aria-label="Status">
          {flying.length > 0 && (
            <section className="tray rise urgent" aria-live="polite">
              <div className="core">
                <h2>Going out</h2>
                {flying.slice(0, 4).map((g) => {
                  const step = flightStep(g)
                  const links = g.rows.flatMap(postLinks)
                  return (
                    <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 14, borderRadius: 16, background: 'var(--well)' }}>
                      <span style={{ fontSize: 14, lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.lead.caption || 'No caption'}</span>
                      <span className={step === 'Posted' ? 'ok' : 'mono'} style={{ fontSize: 13 }}>
                        {step === 'Posted' ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Check />Posted</span> : step}{step === 'Waiting for the next run' && ' · usually within an hour'}
                      </span>
                      {links.length > 0 && (
                        <span className="link-row">
                          {links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener">Open on {NAMED[l.platform]}<NewTab /></a>)}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          <section className={`tray rise${attention.length ? ' urgent' : ''}`}>
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
                    style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 44, textDecoration: 'none' }}>
                    <span className="mono" style={{ color: awaitingHandoff(post) ? '#afc0ff' : '#f5b583' }}>
                      {accountOf(post.account_id)?.name} · {post.platforms.map((p) => PLATFORM_CODES[p]).join(' · ')} · {timeOf(post.publish_at)}
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
                Scheduled runs come about every 30 minutes, but GitHub often starts them late, so allow up to an hour. Post now starts one right away.
              </p>
            </div>
          </section>

          <section className="tray rise">
            <div className="core">
              <h2>Accounts</h2>
              {accounts.length === 0 ? (
                <a className="btn light" href="#/accounts" style={{ alignSelf: 'flex-start' }}>Add an account<span className="knob"><Arrow /></span></a>
              ) : (
                <ul className="side-links">
                  {accounts.map((a) => {
                    const logins = [canPost('facebook', a) && 'FB', canPost('instagram', a) && 'IG', canPost('x', a) && 'X', isConnected(a, 'tiktok') && 'TT'].filter(Boolean)
                    return (
                      <li key={a.id}>
                        <a href="#/accounts"><span>{a.name}</span><span className="mono">{logins.join(' · ') || 'by hand only'}</span></a>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </section>
        </aside>
      </div>
    </>
  )
}

/** Marks a link that opens a new tab: a visual arrow plus words for screen readers. */
function NewTab() {
  return <><span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></>
}
