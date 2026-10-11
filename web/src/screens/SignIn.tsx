import { useState, type FormEvent } from 'react'
import { Arrow, Logo } from '../icons'
import { supabase } from '../supabase'

export default function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'password' | 'link'>('password')
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle')
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setState('busy')
    setError('')
    // Password sign-in sends no email, so it can't hit the free plan's email rate limit.
    // The email link is for existing users only (shouldCreateUser: false); accounts are made in the dashboard.
    const { error } =
      mode === 'password'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signInWithOtp({
            email,
            options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
          })
    if (error) {
      setError(error.message)
      setState('idle')
    } else setState(mode === 'link' ? 'sent' : 'idle')
  }

  return (
    <main className="page" style={{ display: 'grid', placeItems: 'center' }}>
      <div className="tray rise" style={{ width: 'min(440px, 100%)' }}>
        <form className="core" onSubmit={submit} style={{ gap: 24 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600 }}><Logo />PostPilot</span>
          <div className="hero" style={{ gap: 10 }}>
            <h1 style={{ fontSize: 40 }}>Sign in</h1>
            <p style={{ fontSize: 15 }}>{mode === 'password' ? 'With the password set in Supabase.' : "We'll email you a sign-in link."}</p>
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
              {mode === 'password' && (
                <div className="field">
                  <label htmlFor="password">Password</label>
                  <input id="password" className="input" type="password" autoComplete="current-password" required
                    value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              )}
              {error && <p className="notice" role="alert">{error}</p>}
              <button className="btn primary" type="submit" disabled={state === 'busy'}>
                {state === 'busy' ? 'Signing in…' : mode === 'password' ? 'Sign in' : 'Email me a link'}
                <span className="knob"><Arrow /></span>
              </button>
              <button type="button" onClick={() => { setMode(mode === 'password' ? 'link' : 'password'); setError('') }}
                style={{ minHeight: 44, border: 0, background: 'none', color: 'var(--accent-ink)', fontSize: 14, cursor: 'pointer' }}>
                {mode === 'password' ? 'Email me a link instead' : 'Use a password instead'}
              </button>
            </>
          )}
        </form>
      </div>
    </main>
  )
}
