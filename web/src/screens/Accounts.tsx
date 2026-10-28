import { useEffect, useState, type FormEvent } from 'react'
import { Arrow, Asteroids, FlightPath } from '../icons'
import { takeQuery } from '../route'
import { supabase } from '../supabase'
import { ACCOUNT_SELECT, isConnected, type Account, type Connection } from '../types'

const EMPTY = { name: '', fb_page_id: '', ig_user_id: '', token_env: '', timezone: 'Asia/Manila' }
const TOKEN_ENV = /^[A-Z][A-Z0-9_]{0,63}$/ // same rule as the database check

const LOGINS: { c: Connection; name: string; note: string }[] = [
  { c: 'meta', name: 'Facebook + Instagram', note: 'Your Page, and the Instagram account linked to it' },
  { c: 'x', name: 'X', note: 'Posts text, links and one image' },
  { c: 'tiktok', name: 'TikTok', note: 'Sends videos to your TikTok drafts; you finish them in TikTok' },
]
const LOGIN_NAME = Object.fromEntries(LOGINS.map((l) => [l.c, l.name])) as Record<Connection, string>

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [editing, setEditing] = useState<number | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState<Connection | null>(null)

  async function load() {
    const { data, error } = await supabase.from('accounts').select(ACCOUNT_SELECT).order('name')
    if (error) setError(error.message)
    else setAccounts(data as Account[])
  }
  useEffect(() => {
    // Back from a platform's login page (see supabase/functions/connect).
    const q = takeQuery()
    const connected = q.get('connected') as Connection | null
    if (connected && LOGIN_NAME[connected]) setSaved(`${LOGIN_NAME[connected]} connected.`)
    const failed = q.get('error')
    if (failed) setError(failed)
    load()
  }, [])

  async function connect(c: Connection) {
    setBusy(c)
    setError('')
    const { data, error } = await supabase.functions.invoke('connect', { body: { platform: c, account_id: editing } })
    if (error || !data?.url) {
      const context = (error as { context?: Response } | null)?.context
      const body = await context?.json().catch(() => null)
      setBusy(null)
      return setError(body?.error ?? "Couldn't start the login. Try again.")
    }
    window.location.href = data.url // the platform sends you back to this page
  }

  async function disconnect(c: Connection) {
    const { error } = await supabase.from('connections').delete().eq('account_id', editing!).eq('platform', c)
    if (error) return setError(error.message)
    setSaved(`${LOGIN_NAME[c]} disconnected. To revoke it fully, remove PostPilot in that platform's settings too.`)
    load()
  }

  function edit(a: Account | null) {
    setEditing(a?.id ?? null)
    setForm(a ? { name: a.name, fb_page_id: a.fb_page_id, ig_user_id: a.ig_user_id, token_env: a.token_env, timezone: a.timezone } : EMPTY)
    setSaved('')
    setError('')
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const row = { ...form, name: form.name.trim(), fb_page_id: form.fb_page_id.trim(), ig_user_id: form.ig_user_id.trim(), token_env: form.token_env.trim() }
    if (row.token_env && !TOKEN_ENV.test(row.token_env)) return setError('Token secret name: capital letters, digits and _ only, e.g. META_TOKEN_KAPE')
    try {
      new Intl.DateTimeFormat('en', { timeZone: row.timezone })
    } catch {
      return setError(`Unknown time zone '${row.timezone}'. Use a name like Asia/Manila.`)
    }
    const { error } = editing
      ? await supabase.from('accounts').update(row).eq('id', editing)
      : await supabase.from('accounts').insert(row)
    if (error) return setError(error.message.includes('duplicate') ? 'You already have an account with that name' : error.message)
    setSaved(row.token_env ? `Saved. Add a GitHub secret named ${row.token_env} holding this Page's token.` : 'Saved. Now connect its logins.')
    if (!editing) {
      // Stay on the new account so its Connect buttons show right away.
      const { data } = await supabase.from('accounts').select('id').eq('name', row.name).single()
      setEditing(data?.id ?? null)
    }
    load()
  }

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const current = accounts.find((a) => a.id === editing)

  return (
    <>
      <header className="hero sky rise">
        <h1>Accounts</h1>
        <p>One account per brand. Connect its logins once; tokens stay on the server and never reach this app.</p>
        <FlightPath />
        <Asteroids />
      </header>

      <div className="split">
        <section className="main tray rise" aria-label="Your accounts">
          <div className="core flush">
            {accounts.length === 0 ? (
              <p className="empty">No accounts yet. Add your first one.</p>
            ) : (
              <ul className="rows" style={{ paddingTop: 16 }}>
                {accounts.map((a) => (
                  <li key={a.id}>
                    <button type="button" className="row simple" onClick={() => edit(a)}
                      style={{ width: '100%', border: 0, background: editing === a.id ? '#f7f7f3' : 'transparent', textAlign: 'left', cursor: 'pointer' }}>
                      <span style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span style={{ fontSize: 16, fontWeight: 500 }}>{a.name}</span>
                        <span className="mono">{a.timezone}{a.token_env ? ` · ${a.token_env}` : ''}</span>
                      </span>
                      <span style={{ display: 'flex', gap: 6 }}>
                        {a.fb_page_id && <span className="chip done">FB</span>}
                        {a.ig_user_id && <span className="chip done">IG</span>}
                        {isConnected(a, 'x') && <span className="chip done">X</span>}
                        {isConnected(a, 'tiktok') && <span className="chip done">TT</span>}
                        <span className="chip assist">By hand</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <aside className="side">
          <section className="tray rise">
            <form className="core" onSubmit={submit}>
              <h2>{editing ? 'Edit account' : 'Add account'}</h2>
              <div className="field"><label htmlFor="a-name">Name</label>
                <input id="a-name" className="input" required maxLength={60} value={form.name} onChange={set('name')} /></div>
              <div className="field"><label htmlFor="a-fb">Facebook Page ID <span style={{ fontWeight: 400, color: 'var(--muted)' }}>· optional</span></label>
                <input id="a-fb" className="input" inputMode="numeric" value={form.fb_page_id} onChange={set('fb_page_id')} /></div>
              <div className="field"><label htmlFor="a-ig">Instagram user ID <span style={{ fontWeight: 400, color: 'var(--muted)' }}>· optional</span></label>
                <input id="a-ig" className="input" inputMode="numeric" value={form.ig_user_id} onChange={set('ig_user_id')} /></div>
              <div className="field"><label htmlFor="a-token">Token secret name <span style={{ fontWeight: 400, color: 'var(--muted)' }}>· optional, Connect replaces it</span></label>
                <input id="a-token" className="input" autoCapitalize="characters" spellCheck={false} placeholder="META_TOKEN_KAPE" value={form.token_env} onChange={set('token_env')} /></div>
              <div className="field"><label htmlFor="a-tz">Time zone</label>
                <input id="a-tz" className="input" list="tz-list" value={form.timezone} onChange={set('timezone')} />
                <datalist id="tz-list">{['Asia/Manila', 'Asia/Singapore', 'UTC', 'America/New_York', 'Europe/London'].map((z) => <option key={z} value={z} />)}</datalist></div>
              {error && <p className="notice" role="alert">{error}</p>}
              {saved && <p className="ok" role="status" style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>{saved}</p>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                <button className="btn primary" type="submit">{editing ? 'Save' : 'Add account'}<span className="knob"><Arrow /></span></button>
                {editing && <button className="btn" type="button" onClick={() => edit(null)}>Cancel</button>}
              </div>
            </form>
          </section>
          {current && (
            <section className="tray rise" aria-label={`Logins for ${current.name}`}>
              <div className="core">
                <h2>Logins</h2>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 14 }}>
                  {LOGINS.map(({ c, name, note }) => {
                    const login = current.connections?.find((x) => x.platform === c)
                    return (
                      <li key={c} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 160px' }}>
                          <span style={{ fontSize: 15, fontWeight: 500 }}>{name}</span>
                          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{login ? `Connected as ${login.handle}` : note}</span>
                        </span>
                        {login
                          ? <button className="btn" type="button" onClick={() => disconnect(c)}>Disconnect</button>
                          : <button className="btn primary" type="button" disabled={busy !== null} onClick={() => connect(c)}>
                              {busy === c ? 'Opening…' : 'Connect'}<span className="knob"><Arrow /></span></button>}
                      </li>
                    )
                  })}
                </ul>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
                  Shopee, YouTube and your personal Facebook don't let apps post: those come to your phone to post by hand.
                </p>
              </div>
            </section>
          )}
        </aside>
      </div>
    </>
  )
}
