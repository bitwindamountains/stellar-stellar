import { useEffect, useState } from 'react'

/** Hash routes: #/ today, #/new, #/edit/12, #/handoff/12, #/accounts. Hash routing needs no server rewrites. */
export function useRoute(): string[] {
  // A ?query after the route (e.g. #/accounts?connected=x after a login) is read by the screen itself.
  const read = () => window.location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean)
  const [parts, setParts] = useState(read)
  useEffect(() => {
    const onChange = () => setParts(read())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return parts
}

/** Reads and removes the ?query of the current hash route. */
export function takeQuery(): URLSearchParams {
  const [path, query = ''] = window.location.hash.split('?')
  if (query) history.replaceState(null, '', path)
  return new URLSearchParams(query)
}

export function go(path: string): void {
  window.location.hash = path
}

// The tab to go back to after a task screen (composer, post detail). Storage can be blocked (private mode).
const TAB_KEY = 'pp-last-tab'
export function rememberTab(path: string): void {
  try { sessionStorage.setItem(TAB_KEY, path) } catch { /* not remembered: back goes to Today */ }
}
export function lastTab(): string {
  try { return sessionStorage.getItem(TAB_KEY) ?? '/' } catch { return '/' }
}
