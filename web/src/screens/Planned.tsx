import { useCallback, useMemo, useState } from 'react'
import { Constellation } from '../icons'
import PostRow from '../PostRow'
import { draftGroups, localDay, plannedDay, weekDays } from '../selectors'
import { usePosts } from '../usePosts'

const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`)
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

/** The next seven days as a strip; pick a day to see what is going out, then drafts below. */
export default function Planned({ day: routeDay }: { day?: string }) {
  const { posts, accounts, error, loaded } = usePosts()
  const tz = accounts[0]?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  // Calendar-day arithmetic on the local date, so DST never shifts "tomorrow".
  const tomorrow = addDays(localDay(new Date().toISOString(), tz), 1)
  const [picked, setPicked] = useState(routeDay)
  const [offset, setOffset] = useState(() => {
    const diff = routeDay ? Math.round((dayMs(routeDay) - dayMs(tomorrow)) / 86_400_000) : 0
    return diff >= 0 ? Math.floor(diff / 7) * 7 : diff
  })
  const start = addDays(tomorrow, offset)
  const week = useMemo(() => weekDays(posts, start, tz), [posts, start, tz])
  // Default: first day this week with posts, else the first day.
  const selected = picked && week.some((d) => d.day === picked) ? picked : (week.find((d) => d.count > 0) ?? week[0]).day
  const groups = useMemo(() => plannedDay(posts, selected, tz), [posts, selected, tz])
  const drafts = useMemo(() => draftGroups(posts), [posts])
  const accountOf = useCallback((id: number) => accounts.find((a) => a.id === id), [accounts])
  const weekday = new Date(`${selected}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })

  function pick(d: string) {
    setPicked(d)
    history.replaceState(null, '', `#/planned?day=${d}`)
  }

  return (
    <div className="planned">
      <header className="today-head rise">
        <h1>Planned</h1>
        <p>{longDay(selected)}</p>
      </header>

      {error && <p className="notice" role="alert">Couldn't load everything: {error}</p>}

      <div className="wk glass rise">
        <button type="button" className="wk-nav" aria-label="Previous week" disabled={offset <= 0} onClick={() => setOffset(offset - 7)}>‹</button>
        <div className="wk-days">
          {week.map((d) => (
            <button key={d.day} type="button" className="wk-day" aria-pressed={d.day === selected} onClick={() => pick(d.day)}
              aria-label={`${longDay(d.day)}, ${d.count} ${d.count === 1 ? 'post' : 'posts'}`}>
              <span className="mono">{d.weekday}</span>
              <b>{d.date}</b>
              <i className={d.count > 0 ? 'wk-dot on' : 'wk-dot'} aria-hidden="true" />
            </button>
          ))}
        </div>
        <button type="button" className="wk-nav" aria-label="Next week" onClick={() => setOffset(offset + 7)}>›</button>
      </div>

      <section className="tray rise" aria-labelledby="day-title">
        <div className="core flush" aria-busy={!loaded}>
          <div className="day"><h2 id="day-title">{weekday} {longDay(selected).split(', ').pop()}</h2>{groups.length > 0 && <span className="mono">{groups.length}</span>}</div>
          {!loaded && <div className="skeleton" aria-hidden="true" />}
          {loaded && groups.length === 0 && (
            <div className="empty"><Constellation /><p>Nothing planned for {weekday}.</p></div>
          )}
          {groups.length > 0 && (
            <ul className="rows">{groups.map((g) => <PostRow key={g.key} group={g} accountOf={accountOf} tz={tz} />)}</ul>
          )}
          <a className="add-day" href={`#/new?day=${selected}`}>+ Add a post on {weekday}</a>
        </div>
      </section>

      {drafts.length > 0 && (
        <section className="tray rise" aria-labelledby="drafts-title">
          <div className="core flush">
            <div className="day"><h2 id="drafts-title">Drafts</h2><span className="mono">{drafts.length}</span></div>
            <ul className="rows">
              {drafts.map((g) => <PostRow key={g.key} group={g} accountOf={accountOf} tz={tz} href={`#/edit/${g.lead.num}`} />)}
            </ul>
          </div>
        </section>
      )}
    </div>
  )
}
