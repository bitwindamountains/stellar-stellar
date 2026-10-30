import { useCallback, useMemo, useState } from 'react'
import { retryNow } from '../actions'
import { groupHref, type PostGroup } from '../groups'
import { Constellation } from '../icons'
import PostRow from '../PostRow'
import { awaitingHandoff, canRetry } from '../postView'
import { isStale, needsAttention, todayView } from '../selectors'
import { PLATFORM_CODES, type Account, type Post } from '../types'
import { usePosts } from '../usePosts'

/** Home: what's going out today, and anything that needs you. */
export default function Today() {
  const { posts, accounts, error: loadError, loaded, reload } = usePosts()
  const [actionError, setActionError] = useState('')
  const [retrying, setRetrying] = useState<number | null>(null)
  const tz = accounts[0]?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const now = new Date()
  const { needsYou, goingOut, outToday } = useMemo(() => todayView(posts, new Date(), tz), [posts, tz])
  const accountOf = useCallback((id: number) => accounts.find((a) => a.id === id), [accounts])
  const error = actionError || loadError

  async function retry(num: number) {
    setRetrying(num)
    setActionError('')
    const failed = await retryNow(num)
    setRetrying(null)
    if (failed) setActionError(failed)
    else reload()
  }

  return (
    <div className="today">
      <header className="today-head rise">
        <h1>Today</h1>
        <p>{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz })}</p>
      </header>

      {error && <p className="notice" role="alert">Couldn't load everything: {error}</p>}

      {needsYou.length > 0 && (
        <section className="glass needs rise" aria-labelledby="needs-title">
          <h2 id="needs-title">Needs you <span className="needs-count">{needsYou.length}</span></h2>
          <ul className="needs-list">
            {needsYou.map((g) => (
              <NeedItem key={g.key} group={g} now={now} tz={tz} accountOf={accountOf} retrying={retrying} onRetry={retry} />
            ))}
          </ul>
        </section>
      )}

      <section className="tray rise" aria-labelledby="out-title">
        <div className="core flush" aria-busy={!loaded}>
          <div className="day"><h2 id="out-title">Going out today</h2>{goingOut.length > 0 && <span className="mono">{goingOut.length}</span>}</div>
          {!loaded && [0, 1].map((i) => <div key={i} className="skeleton" aria-hidden="true" />)}
          {loaded && goingOut.length === 0 && (
            <div className="empty">
              <Constellation />
              <p>{outToday.length ? 'Nothing else' : 'Nothing'} going out today. <a href="#/new">Write a post</a>.</p>
            </div>
          )}
          {goingOut.length > 0 && (
            <ul className="rows">
              {goingOut.map((g) => <PostRow key={g.key} group={g} accountOf={accountOf} tz={tz} />)}
            </ul>
          )}
        </div>
      </section>

      {outToday.length > 0 && (
        <section className="tray rise" aria-labelledby="done-title">
          <div className="core flush">
            <div className="day"><h2 id="done-title">Out today</h2><span className="mono">{outToday.length}</span></div>
            <ul className="rows">
              {outToday.map((g) => <PostRow key={g.key} group={g} accountOf={accountOf} tz={tz} />)}
            </ul>
          </div>
        </section>
      )}
    </div>
  )
}

/** One thing to check: what it is, why it stopped, and the one action that fixes it. */
function NeedItem({ group: g, now, tz, accountOf, retrying, onRetry }: {
  group: PostGroup
  now: Date
  tz: string
  accountOf: (id: number) => Account | undefined
  retrying: number | null
  onRetry: (num: number) => void
}) {
  const rows = g.rows.filter((r) => needsAttention(r, now))
  const multi = g.rows.length > 1
  const who = (r: Post) => (multi ? `${accountOf(r.account_id)?.name ?? ''}: ` : '')
  const when = g.lead.publish_at
    ? new Date(g.lead.publish_at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz })
    : 'No time set'
  const why = (r: Post) => awaitingHandoff(r) ? 'Waiting for you to post it by hand.'
    : r.last_error || (isStale(r, now) ? 'Still posting after 30 minutes. Check whether it went out.' : 'Check this post.')

  return (
    <li className="need">
      <span className="need-meta mono">
        {g.rows.map((r) => r.platforms.map((p) => PLATFORM_CODES[p]).join(' · ')).join(' + ')} · {when}
      </span>
      <a className="need-caption" href={groupHref(g.rows)}><span>{g.lead.caption || 'No caption'}</span></a>
      {rows.map((r) => <p key={r.num} className="need-why">{who(r)}{why(r)}</p>)}
      <div className="need-actions">
        {rows.filter(awaitingHandoff).map((r) => (
          <a key={r.num} className="btn primary small" href={`#/handoff/${r.num}`}>Post it now{multi ? ` · ${accountOf(r.account_id)?.name ?? ''}` : ''}</a>
        ))}
        {rows.filter(canRetry).map((r) => (
          <button key={r.num} type="button" className="btn light small" onClick={() => onRetry(r.num)} disabled={retrying === r.num}>
            {retrying === r.num ? 'Retrying…' : 'Retry now'}{multi ? ` · ${accountOf(r.account_id)?.name ?? ''}` : ''}
          </button>
        ))}
      </div>
    </li>
  )
}
