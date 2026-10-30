import type { Session } from '@supabase/supabase-js'
import { useEffect, useRef, useState } from 'react'
import { Asteroids, Exit, FlightPath } from './icons'
import Nav from './Nav'
import { rememberTab, useRoute } from './route'
import Accounts from './screens/Accounts'
import Composer from './screens/Composer'
import Handoff from './screens/Handoff'
import History from './screens/History'
import Planned from './screens/Planned'
import PostDetail from './screens/PostDetail'
import SignIn from './screens/SignIn'
import Today from './screens/Today'
import { parseRoute } from './selectors'
import { supabase } from './supabase'

const TABS: Record<string, string> = { today: '/', planned: '/planned', history: '/history', accounts: '/accounts' }

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const route = parseRoute(useRoute(), new URLSearchParams(location.hash.split('?')[1] ?? ''))
  const { screen } = route

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  // Task screens (composer, post detail) go back to the tab you came from.
  useEffect(() => { if (TABS[screen]) rememberTab(TABS[screen]) }, [screen])

  // Pointer parallax for the night-sky layers (desktop only): CSS reads --px/--py in -1..1. No React state,
  // at most one write per frame.
  useEffect(() => {
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let frame = 0
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const s = document.documentElement.style
        s.setProperty('--px', ((e.clientX / innerWidth) * 2 - 1).toFixed(3))
        s.setProperty('--py', ((e.clientY / innerHeight) * 2 - 1).toFixed(3))
      })
    }
    addEventListener('pointermove', move)
    return () => { removeEventListener('pointermove', move); cancelAnimationFrame(frame) }
  }, [])

  if (session === undefined) return null
  if (session === null) return <SignIn />

  // The handoff is a phone screen opened from Telegram: no nav, just the task.
  if (route.screen === 'handoff') return <><Starfield /><Handoff num={route.num} /></>

  // Writing gets the whole phone screen: no tab bar there (the desktop sidebar stays).
  const composing = screen === 'new' || screen === 'edit'
  return (
    <div className={composing ? 'app composing' : 'app'}>
      <Starfield />
      <Nav current={screen}><SignOut /></Nav>
      <div className="page">
        <div className="wrap">
          {route.screen === 'today' && <Today />}
          {route.screen === 'planned' && <Planned day={route.day} />}
          {route.screen === 'history' && <History />}
          {route.screen === 'post' && <PostDetail num={route.num} />}
          {route.screen === 'new' && <Composer />}
          {route.screen === 'edit' && <Composer num={route.num} />}
          {route.screen === 'accounts' && <Accounts />}
        </div>
      </div>
    </div>
  )
}

// The night sky behind every screen, drawn once: dark at the top, fading into the page.
const Starfield = () => (
  <div className="starfield" aria-hidden="true"><FlightPath /><Asteroids /></div>
)

// Visible but hard to hit by accident: set apart at the end of the nav, and it takes two taps. The first
// arms it for 3 s; a second tap within 0.4 s (a double-tap slip) is ignored.
function SignOut() {
  const [armedAt, setArmedAt] = useState(0)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  function click() {
    if (!armedAt) {
      setArmedAt(Date.now())
      timer.current = window.setTimeout(() => setArmedAt(0), 3000)
    } else if (Date.now() - armedAt > 400) {
      clearTimeout(timer.current)
      supabase.auth.signOut()
    }
  }
  return (
    <button type="button" className={armedAt ? 'signout armed' : 'signout'} onClick={click}
      aria-label={armedAt ? 'Tap again to sign out' : 'Sign out'}>
      <Exit />
      <span className="signout-text" aria-live="polite">{armedAt ? <><span className="signout-long">Tap again to sign out</span><span className="signout-short">Sure?</span></> : 'Sign out'}</span>
    </button>
  )
}
