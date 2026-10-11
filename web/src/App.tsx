import type { Session } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { Logo, Plus } from './icons'
import { useRoute } from './route'
import Accounts from './screens/Accounts'
import Composer from './screens/Composer'
import Handoff from './screens/Handoff'
import Queue from './screens/Queue'
import SignIn from './screens/SignIn'
import { supabase } from './supabase'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const route = useRoute()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

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

  const [screen = '', id] = route
  // The handoff is a phone screen opened from Telegram: no nav, just the task.
  if (screen === 'handoff' && id) return <Handoff num={Number(id)} />

  return (
    <div className="page">
      <div className="wrap">
        <nav className="island" aria-label="Main">
          <a href="#/" className="brand"><Logo />PostPilot</a>
          <a href="#/" aria-current={screen === '' ? 'page' : undefined}>Queue</a>
          <a href="#/accounts" aria-current={screen === 'accounts' ? 'page' : undefined}>Accounts</a>
          <a href="#/new" className="btn primary" aria-current={screen === 'new' ? 'page' : undefined}
            style={{ color: '#fff', minHeight: 44 }}>
            New post<span className="knob"><Plus /></span>
          </a>
        </nav>
        {screen === 'new' && <Composer />}
        {screen === 'edit' && id && <Composer num={Number(id)} />}
        {screen === 'accounts' && <Accounts />}
        {screen === '' && <Queue />}
      </div>
    </div>
  )
}
