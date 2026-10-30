import { useEffect, useState } from 'react'
import { startPostAgain } from '../actions'
import { postLinks } from '../groups'
import { NewTab } from '../icons'
import { ago, compact, errorNotes } from '../postView'
import { lastTab } from '../route'
import { supabase } from '../supabase'
import { sentByHand, type PlatformStats, type Post } from '../types'
import { usePosts } from '../usePosts'

const TAB_NAMES: Record<string, string> = { '/': 'Today', '/planned': 'Planned', '/history': 'History', '/accounts': 'Accounts' }
type Meta = 'facebook' | 'instagram'
const NAMED: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', x: 'X', tiktok: 'TikTok' }
const NUMBERS: [keyof PlatformStats, string][] = [['views', 'Views'], ['reach', 'Reach'], ['likes', 'Likes'], ['comments', 'Comments'], ['shares', 'Shares']]

/** The comment ID columns can hold the sentinels 'not-added' / 'unclear' (never real IDs, never links). */
function firstCommentNote(post: Post, p: Meta): { text: string; warn: boolean } {
  const id = p === 'facebook' ? post.fb_comment_id : post.ig_comment_id
  if (id === 'not-added') return { text: 'First comment not added — add it by hand', warn: true }
  if (id === 'unclear') return { text: 'First comment may not have been added — check', warn: true }
  if (id) return { text: 'First comment posted', warn: false }
  return post.first_comment ? { text: 'First comment not recorded — check', warn: true } : { text: 'No first comment', warn: false }
}

/** One post that went out: how it did per account and platform, its first comment, top comments. */
export default function PostDetail({ num }: { num: number }) {
  const { accounts } = usePosts()
  // ponytail: one zone for all accounts (the first's); use each group's lead account zone if accounts in different zones are ever added.
  const tz = accounts[0]?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const [rows, setRows] = useState<Post[] | null>(null)
  const [error, setError] = useState('')
  const [account, setAccount] = useState<number | null>(null)
  const [picked, setPicked] = useState<Meta | null>(null)

  useEffect(() => {
    let current = true
    setRows(null)
    ;(async () => {
      const one = await supabase.from('posts').select('*').eq('num', num).maybeSingle()
      if (!current) return
      if (one.error) return setError(one.error.message)
      const first = one.data as Post | null
      if (!first) return setRows([])
      const all = first.group_id ? await supabase.from('posts').select('*').eq('group_id', first.group_id).order('num') : null
      if (!current) return
      if (all?.error) return setError(all.error.message)
      setRows((all?.data as Post[] | undefined) ?? [first])
    })()
    return () => { current = false }
  }, [num])

  const back = lastTab()
  const head = (
    <a className="h-back glass rise" href={`#${back}`} onClick={(e) => { e.preventDefault(); location.replace(`#${back}`) }}><span aria-hidden="true">‹</span>{TAB_NAMES[back] ?? 'Back'}</a>
  )
  if (error) return <div className="history">{head}<p className="notice" role="alert">Couldn't load this post: {error}</p></div>
  if (rows === null) return <div className="history" aria-busy="true">{head}<div className="tray"><div className="core flush"><div className="skeleton" aria-hidden="true" /><div className="skeleton" aria-hidden="true" /></div></div></div>
  if (rows.length === 0) return <div className="history">{head}<p className="notice" role="alert">This post isn't here any more. It may have been deleted.</p></div>

  const row = rows.find((r) => r.account_id === account) ?? rows[0]
  const lead = rows[0]
  const metas = row.platforms.filter((p): p is Meta => p === 'facebook' || p === 'instagram')
  const platform = picked && metas.includes(picked) ? picked : metas[0]
  const stats = platform ? row.stats?.[platform] : undefined
  const comments = stats?.top_comments ?? []
  const nameOf = (id: number) => accounts.find((a) => a.id === id)?.name ?? `Account ${id}`
  const byHand = row.platforms.filter((p) => sentByHand(row, p, accounts.find((a) => a.id === row.account_id)))
  const image = lead.media_type === 'image' ? lead.media_urls[0] : undefined
  const at = row.posted_at ?? row.publish_at
  const when = at ? new Date(at).toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }) : ''
  const note = firstCommentNote(row, platform ?? 'facebook')
  const links = postLinks(row)
  const notes = errorNotes(row.last_error, platform)

  return (
    <div className="history">
      {head}
      <header className="today-head rise">
        <h1>How it did</h1>
        {when && <p>{row.status === 'posted' ? 'Went out' : 'Planned for'} {when}</p>}
      </header>

      <section className="tray rise" aria-label="The post">
        <div className="core d-post">
          {lead.media_type !== 'none' && (
            <span className="thumb d-thumb" aria-hidden="true" style={image ? { backgroundImage: `url("${image}")`, color: 'transparent' } : undefined}>
              {lead.media_type}
            </span>
          )}
          <p className="d-caption">{lead.caption || 'No caption'}</p>
        </div>
      </section>

      {notes.general && <p className="d-note rise">{notes.general}</p>}

      {(rows.length > 1 || metas.length > 1) && (
        <div className="d-switch rise">
          {rows.length > 1 && (
            <div role="group" aria-label="Account" className="filters">
              {rows.map((r) => (
                <button key={r.num} type="button" aria-pressed={r === row} onClick={() => setAccount(r.account_id)}>{nameOf(r.account_id)}</button>
              ))}
            </div>
          )}
          {metas.length > 1 && (
            <div role="group" aria-label="Platform" className="filters">
              {metas.map((p) => (
                <button key={p} type="button" aria-pressed={p === platform} onClick={() => setPicked(p)}>{NAMED[p]}</button>
              ))}
            </div>
          )}
        </div>
      )}

      <section className="tray rise" aria-labelledby="d-numbers">
        <div className="core">
          <div className="d-title">
            <h2 id="d-numbers">{platform ? NAMED[platform] : 'By hand'}{rows.length > 1 ? ` · ${nameOf(row.account_id)}` : ''}</h2>
            {stats?.as_of && <span className="mono">as of {ago(stats.as_of)}</span>}
          </div>
          {platform ? (
            <>
              <dl className="d-stats">
                {NUMBERS.map(([key, label]) => {
                  const n = stats?.[key] as number | undefined
                  return <div key={key}><dt>{label}</dt><dd>{n == null ? '—' : compact(n)}</dd></div>
                })}
              </dl>
              {!stats && <p className="d-quiet">No numbers yet. They're collected a while after the post goes out.</p>}
              <p className={note.warn ? 'd-comment warn' : 'd-comment'}>{note.text}</p>
            </>
          ) : (
            <p className="d-quiet">Posted by hand ({byHand.map((p) => NAMED[p] ?? p).join(', ') || 'phone'}) · no stats.</p>
          )}
          {notes.comment.map((n) => <p key={n} className="d-note">{n}</p>)}
          <div className="d-actions">
            {links.map((l) => (
              <a key={l.platform} className="btn light small" href={l.url} target="_blank" rel="noopener">
                Open on {NAMED[l.platform]}<NewTab /><span className="sr-only"> (opens in a new tab)</span>
              </a>
            ))}
            <button type="button" className="btn dark small" onClick={() => startPostAgain(rows)}>Post again</button>
          </div>
        </div>
      </section>

      {comments.length > 0 && (
        <section className="tray rise" aria-labelledby="d-top">
          <div className="core">
            <h2 id="d-top">Top comments</h2>
            <ul className="d-comments">
              {comments.map((c, i) => (
                <li key={i}>
                  <div className="d-who"><strong>{c.author}</strong><span className="mono">♥ {compact(c.likes)} · {ago(c.at)}</span></div>
                  <p>{c.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  )
}
