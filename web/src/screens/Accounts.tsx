import { useEffect, useState, type FormEvent } from 'react'
import { Arrow } from '../icons'
import { supabase } from '../supabase'
import type { Account } from '../types'

const EMPTY = { name: '', fb_page_id: '', ig_user_id: '', token_env: '', timezone: 'Asia/Manila' }
const TOKEN_ENV = /^[A-Z][A-Z0-9_]{0,63}$/ // same rule as the database check

function suggestTokenEnv(name: string): string {
  const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')
  return slug ? `META_TOKEN_${slug}` : ''
}

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [editing, setEditing] = useState<number | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  async function load() {
    const { data, error } = await supabase.from('accounts').select('*').order('name')
    if (error) setError(error.message)
    else setAccounts(data as Account[])
  }
  useEffect(() => { load() }, [])

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
    if ((row.fb_page_id || row.ig_user_id) && !row.token_env) return setError('Facebook/Instagram need a token secret name')
    try {
      new Intl.DateTimeFormat('en', { timeZone: row.timezone })
    } catch {
      return setError(`Unknown time zone '${row.timezone}'. Use a name like Asia/Manila.`)
    }
    const { error } = editing
      ? await supabase.from('accounts').update(row).eq('id', editing)
      : await supabase.from('accounts').insert(row)
    if (error) return setError(error.message.includes('duplicate') ? 'You already have an account with that name' : error.message)
    setSaved(row.token_env ? `Saved. Add a GitHub secret named ${row.token_env} holding this Page's token.` : 'Saved.')
    setEditing(null)
    setForm(EMPTY)
    load()
  }

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => {
    const next = { ...f, [k]: e.target.value }
    // Keep the suggested secret name in step with the account name until the user types their own.
    if (k === 'name' && (f.token_env === '' || f.token_env === suggestTokenEnv(f.name))) next.token_env = suggestTokenEnv(e.target.value)
    return next
  })

  return (
    <>
      <header className="hero rise">
        <h1>Accounts</h1>
        <p>One account per brand. Tokens never live here: the publisher reads them from GitHub secrets by name.</p>
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
              <div className="field"><label htmlFor="a-token">Token secret name</label>
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
          <button type="button" className="btn" onClick={() => supabase.auth.signOut()} style={{ alignSelf: 'flex-start' }}>Sign out</button>
        </aside>
      </div>
    </>
  )
}
