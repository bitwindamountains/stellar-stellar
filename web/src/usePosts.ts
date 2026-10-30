import { useCallback, useEffect, useState } from 'react'
import { mergePosts } from './postView'
import { supabase } from './supabase'
import { ACCOUNT_SELECT, type Account, type Post, type Run } from './types'

/** The live queue the tab screens read: posts, accounts and the last run, kept fresh by Realtime. */
export function usePosts() {
  const [posts, setPosts] = useState<Post[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [run, setRun] = useState<Run | null>(null)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  const reload = useCallback(() => {
    // Last 2 days onward, plus undated drafts. ponytail: no paging; fine for a personal queue of a few hundred.
    const since = new Date(Date.now() - 2 * 86_400_000).toISOString()
    Promise.all([
      supabase.from('posts').select('*').or(`publish_at.gte.${since},publish_at.is.null`).order('publish_at').limit(300),
      supabase.from('accounts').select(ACCOUNT_SELECT).order('name'),
      supabase.from('runs').select('*').order('ran_at', { ascending: false }).limit(1),
      // Unresolved posts stay visible however old, so a failure can't quietly drop out of "Needs you".
      // Newest first up to 1,000 (Supabase's default row cap); a personal queue won't get near that.
      supabase.from('posts').select('*').in('status', ['failed', 'missed', 'partial', 'posting'])
        .order('publish_at', { ascending: false }).limit(1000),
      supabase.from('posts').select('*').neq('tg_message_id', '').is('assist_done_at', null)
        .order('publish_at', { ascending: false }).limit(1000),
    ]).then(([p, a, r, unresolved, handoffs]) => {
      const failed = p.error ?? a.error ?? r.error ?? unresolved.error ?? handoffs.error
      setError(failed ? failed.message : '')
      setPosts(mergePosts(p.data, unresolved.data, handoffs.data))
      setAccounts((a.data as Account[]) ?? [])
      setRun(((r.data as Run[]) ?? [])[0] ?? null)
      setLoaded(true)
    })
  }, [])
  useEffect(reload, [reload])

  // Live: reload shortly after any post or run changes (Realtime), and when the app comes back to the front.
  useEffect(() => {
    let timer = 0
    const soon = () => { clearTimeout(timer); timer = window.setTimeout(reload, 400) }
    const channel = supabase.channel('posts-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, soon)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'runs' }, soon)
      .subscribe()
    const onShow = () => { if (document.visibilityState === 'visible') soon() }
    document.addEventListener('visibilitychange', onShow)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onShow); supabase.removeChannel(channel) }
  }, [reload])

  return { posts, accounts, run, error, loaded, reload }
}
