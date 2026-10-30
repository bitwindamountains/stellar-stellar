import type { ReactNode } from 'react'
import { AccountsIcon, HistoryIcon, Logo, PlannedIcon, Plus, TodayIcon } from './icons'
import type { Route } from './selectors'

type Screen = Route['screen']

// One nav for both layouts: a floating glass capsule at the bottom on a phone, a glass sidebar from 900px.
// The layout switch is CSS only. `children` (sign out) sits at the end of the sidebar.
export default function Nav({ current, children }: { current: Screen; children?: ReactNode }) {
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
      {children}
    </nav>
  )
}
