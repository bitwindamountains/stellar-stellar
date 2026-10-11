import { useEffect, useState } from 'react'

/** Hash routes: #/ queue, #/new, #/edit/12, #/handoff/12, #/accounts. Hash routing needs no server rewrites. */
export function useRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const [parts, setParts] = useState(read)
  useEffect(() => {
    const onChange = () => setParts(read())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return parts
}

export function go(path: string): void {
  window.location.hash = path
}
