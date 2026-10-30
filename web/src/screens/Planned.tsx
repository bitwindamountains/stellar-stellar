import { useCallback, useMemo, useState } from 'react'
import { Constellation } from '../icons'
import PostRow from '../PostRow'
import { addDays, draftGroups, localDay, plannedDay, weekDays, weekStartFor } from '../selectors'
import { usePosts } from '../usePosts'

const fmt = (day: string, o: Intl.DateTimeFormatOptions) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { ...o, timeZone: 'UTC' })
const longDay = (day: string) => fmt(day, { weekday: 'long', day: 'numeric', month: 'long' })

/** The next seven days as a strip; pick a day to see what is going out, then drafts below. */
export default function Planned({ day: routeDay }: { day?: string }) {
  const { posts, accounts, error, loaded } = usePosts()
  // ponytail: one zone for all accounts (the first's); use each group's lead account zone if accounts in different zones are ever added.
  const tz = accounts[0]?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  // Calendar-day arithmetic on the local date, so DST never shifts "tomorrow".
  const tomorrow = addDays(localDay(new Date().toISOString(), tz), 1)
  const first = useMemo(() => weekStartFor(routeDay, tomorrow), [routeDay, tomorrow])
  const [picked, setPicked] = useState(first.selected)
  const [start, setStart] = useState(first.start)
  const week = useMemo(() => weekDays(posts, start, tz), [posts, start, tz])
  // Default: first day this week with posts, else the first day.
  const selected = picked && week.some((d) => d.day === picked) ? picked : (week.find((d) => d.count > 0) ?? week[0]).day
  const groups = useMemo(() => plannedDay(posts, selected, tz), [posts, selected, tz])
  const drafts = useMemo(() => draftGroups(posts), [posts])
  const accountOf = useCallback((id: number) => accounts.find((a) => a.id === id), [accounts])
  const weekday = fmt(selected, { weekday: 'long' })

  function pick(d: string) {
    setPicked(d)
    history.replaceState(null, '', `#/planned?day=${d}`)
  }

  return (
    <div className="planned">
      <header className="planned-head rise">
        <div className="today-head">
        <h1>Planned</h1>
        <p>{longDay(selected)}</p>
        </div>
        <div className="wk-navs">
          <button type="button" className="wk-nav glass" aria-label="Previous week" disabled={start <= tomorrow} onClick={() => setStart(addDays(start, -7))}>‹</button>
          <button type="button" className="wk-nav glass" aria-label="Next week" onClick={() => setStart(addDays(start, 7))}>›</button>
        </div>
      </header>

      {error && <p className="notice" role="alert">Couldn't load everything: {error}</p>}

      <div className="wk glass rise">
        <div className="wk-days">
          {week.map((d) => (
            <button key={d.day} type="button" className="wk-day" aria-pressed={d.day === selected} onClick={() => pick(d.day)}
              aria-label={`${longDay(d.day)}, ${d.count} ${d.count === 1 ? 'post' : 'posts'}`}>
              <span className="mono">{fmt(d.day, { weekday: 'short' })}</span>
              <b>{d.date}</b>
              <i className={d.count > 0 ? 'wk-dot on' : 'wk-dot'} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      <section className="tray rise" aria-labelledby="day-title">
        <div className="core flush" aria-busy={!loaded}>
          <div className="day"><h2 id="day-title">{longDay(selected)}</h2>{groups.length > 0 && <span className="mono">{groups.length}</span>}</div>
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
