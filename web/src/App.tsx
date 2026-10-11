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
          <button type="button" className="desktop-only" onClick={() => supabase.auth.signOut()}>Sign out</button>
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
