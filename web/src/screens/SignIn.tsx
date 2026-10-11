import { useState, type FormEvent } from 'react'
import { Arrow, Logo } from '../icons'
import { supabase } from '../supabase'

export default function SignIn() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setState('sending')
    setError('')
    // shouldCreateUser: false — only existing users can sign in; new accounts are made in the Supabase dashboard.
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
    })
    if (error) {
      setError(error.message)
      setState('idle')
    } else setState('sent')
  }

  return (
    <main className="page" style={{ display: 'grid', placeItems: 'center' }}>
      <div className="tray rise" style={{ width: 'min(440px, 100%)' }}>
        <form className="core" onSubmit={submit} style={{ gap: 24 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600 }}><Logo />PostPilot</span>
          <div className="hero" style={{ gap: 10 }}>
            <h1 style={{ fontSize: 40 }}>Sign in</h1>
            <p style={{ fontSize: 15 }}>We'll email you a sign-in link.</p>
          </div>
          {state === 'sent' ? (
            <p className="ok" role="status">Check {email} for the link. You can close this tab.</p>
          ) : (
            <>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" className="input" type="email" autoComplete="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)} />
              </div>
              {error && <p className="notice" role="alert">{error}</p>}
              <button className="btn primary" type="submit" disabled={state === 'sending'}>
                {state === 'sending' ? 'Sending…' : 'Email me a link'}<span className="knob"><Arrow /></span>
              </button>
            </>
          )}
        </form>
      </div>
    </main>
  )
}
