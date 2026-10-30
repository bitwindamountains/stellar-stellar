import type { ReactNode } from 'react'
import { AccountsIcon, HistoryIcon, Logo, PlannedIcon, Plus, TodayIcon } from './icons'
import type { Route } from './selectors'

type Screen = Route['screen']

// One nav for both layouts: a floating glass capsule at the bottom on a phone, a glass sidebar from 900px.
// The layout switch is CSS only. Sign out lives on Accounts.
export default function Nav({ current }: { current: Screen }) {
  const link = (href: string, screen: Screen, label: string, icon: ReactNode) => (
    <a href={href} aria-current={current === screen ? 'page' : undefined}>
      {icon}<span className="nav-label">{label}</span>
    </a>
  )
  return (
    <nav className="nav glass" aria-label="Main">
      <a href="#/" className="nav-brand"><Logo />PostPilot</a>
      {link('#/', 'today', 'Today', <TodayIcon />)}
      {link('#/planned', 'planned', 'Planned', <PlannedIcon />)}
      <a href="#/new" className="nav-new" aria-label="New post" aria-current={current === 'new' ? 'page' : undefined}>
        <span className="nav-orb"><Plus /></span><span className="nav-label">New post</span>
      </a>
      {link('#/history', 'history', 'History', <HistoryIcon />)}
      {link('#/accounts', 'accounts', 'Accounts', <AccountsIcon />)}
    </nav>
  )
}
