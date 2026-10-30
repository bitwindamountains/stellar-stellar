import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { groupPosts, groupStatus, type PostGroup } from '../groups'
import { Constellation } from '../icons'
import { mergePosts, statsLine } from '../postView'
import { historyGroups, type HistoryFilter } from '../selectors'
import { supabase } from '../supabase'
import { PLATFORM_NAMES, sentByHand, type Account, type Platform, type Post } from '../types'
import { usePosts } from '../usePosts'

const PAGE = 30
const FILTERS: [HistoryFilter, string][] = [['all', 'All'], ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['hand', 'By hand']]
const shortName = (p: Platform) => (p === 'facebook' ? 'Facebook' : PLATFORM_NAMES[p])

/** What went out, newest first, 30 at a time; search looks through every caption in the database. */
export default function History() {
  const { accounts } = usePosts()
  const tz = accounts[0]?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const accountOf = useCallback((id: number) => accounts.find((a) => a.id === id), [accounts])
  const [filter, setFilter] = useState<HistoryFilter>('all')
  const [rows, setRows] = useState<Post[]>([])
  const [end, setEnd] = useState(false)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const fetched = useRef(0) // rows paged in so far (the next .range starts here)
  const loading = useRef(false)
  const sentinel = useRef<HTMLDivElement>(null)

  const loadMore = useCallback(async () => {
    if (loading.current) return
    loading.current = true
    setBusy(true)
    const from = fetched.current
    const { data, error } = await supabase.from('posts').select('*').eq('status', 'posted')
      .order('posted_at', { ascending: false }).range(from, from + PAGE - 1)
    loading.current = false
    setBusy(false)
    if (error) return setError(error.message)
    setError('')
    const got = (data as Post[]) ?? []
    fetched.current += got.length
    setRows((r) => mergePosts(r, got))
    if (got.length < PAGE) setEnd(true)
  }, [])
  useEffect(() => { loadMore() }, [loadMore])

  // Search: every status, straight from the database, 300 ms after typing stops.
  const [search, setSearch] = useState('')
  const [found, setFound] = useState<Post[] | null>(null)
  const query = search.trim()
  useEffect(() => {
    setFound(null)
    if (!query) return
    let current = true // a slower, older query must not overwrite a newer one
    const timer = setTimeout(() => {
      supabase.from('posts').select('*').ilike('caption', `%${query.replace(/[%_\\]/g, '\\$&')}%`)
        .order('publish_at', { ascending: false }).limit(200)
        .then(({ data, error }) => {
          if (!current) return
          if (error) setError(error.message)
          setFound((data as Post[]) ?? [])
        })
    }, 300)
    return () => { current = false; clearTimeout(timer) }
  }, [query])

  // Older pages load as the end of the list scrolls into view; re-armed after each page.
  useEffect(() => {
    const el = sentinel.current
    if (!el || end || query || error) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) loadMore() }, { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [end, query, error, rows.length, loadMore])

  const groups = useMemo(() => {
    if (!query) return historyGroups(rows, filter, accountOf)
    if (!found) return []
    return filter === 'all' ? groupPosts(found) : historyGroups(found, filter, accountOf)
  }, [query, found, rows, filter, accountOf])
  const searching = !!query && found === null
  const loaded = !busy || rows.length > 0

  return (
    <div className="history">
      <header className="today-head rise">
        <h1>History</h1>
        <p>What went out, and how it did.</p>
      </header>

      <div className="h-tools glass rise">
        <label htmlFor="h-search" className="sr-only">Search captions</label>
        <input id="h-search" className="input search" type="search" placeholder="Search captions, past and planned"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <div role="group" aria-label="Show" className="filters h-filters">
          {FILTERS.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>
          ))}
        </div>
      </div>

      {error && <p className="notice" role="alert">Couldn't load everything: {error}</p>}

      <section className="tray rise" aria-label={query ? 'Search results' : 'Posts that went out'}>
        <div className="core flush" aria-busy={!loaded || searching}>
          {(!loaded || searching) && groups.length === 0 && [0, 1, 2].map((i) => <div key={i} className="skeleton" aria-hidden="true" />)}
          {loaded && !searching && groups.length === 0 && (
            <div className="empty">
              {query ? <p>No captions match “{query}”.</p>
                : filter === 'all' ? <><Constellation /><p>Nothing has gone out yet. <a href="#/new">Write a post</a>.</p></>
                  : <p>Nothing {filter === 'hand' ? 'posted by hand' : `on ${shortName(filter)}`} {end ? 'yet' : 'in what has loaded so far'}.</p>}
            </div>
          )}
          {groups.length > 0 && (
            <ul className="rows h-rows">
              {groups.map((g) => <HistoryCard key={g.key} group={g} tz={tz} accountOf={accountOf} />)}
            </ul>
          )}
          {!query && !end && (
            <div ref={sentinel} className="h-more">
              <button type="button" className="btn small" onClick={loadMore} disabled={busy}>{busy ? 'Loading…' : 'Load more'}</button>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

/** One post (all its accounts): picture, caption, how it did, when and where. */
function HistoryCard({ group: g, tz, accountOf }: { group: PostGroup; tz: string; accountOf: (id: number) => Account | undefined }) {
  const lead = g.lead
  const posted = g.rows.some((r) => r.status === 'posted')
  const image = lead.media_type === 'image' ? lead.media_urls[0] : undefined
  const at = g.rows.map((r) => r.posted_at).filter(Boolean).sort().reverse()[0] ?? lead.publish_at
  const when = at ? new Date(at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }) : 'No time set'
  const where = [...new Set(g.rows.flatMap((r) => r.platforms))].map(shortName).join(', ')
  const best = g.rows.map((r) => r.stats?.facebook).find(Boolean) ?? g.rows.map((r) => r.stats?.instagram).find(Boolean)
  const byHandOnly = g.rows.every((r) => r.platforms.every((p) => sentByHand(r, p, accountOf(r.account_id))))
  const numbers = best && statsLine(best)
  const status = groupStatus(g.rows)

  return (
    <li>
      <a className="row h-row" href={posted ? `#/history/${lead.num}` : `#/edit/${lead.num}`}>
        <span className="thumb" aria-hidden="true" style={image ? { backgroundImage: `url("${image}")`, color: 'transparent' } : undefined}>
          {lead.media_type === 'none' ? (lead.link ? 'Link' : 'Text') : lead.media_type}
        </span>
        <span className="h-body">
          <span className="h-caption">{lead.caption || <span style={{ color: 'var(--muted)' }}>No caption</span>}</span>
          {posted ? (
            <span className={numbers ? 'h-stats' : 'h-stats quiet'}>{numbers || (byHandOnly ? 'By hand · no stats' : 'No stats yet')}</span>
          ) : <span className={`pill ${status.tone}`}>{status.text}</span>}
          <span className="mono h-where">{when} · {g.rows.length > 1 ? `${g.rows.length} accounts · ` : ''}{where}</span>
        </span>
      </a>
    </li>
  )
}
