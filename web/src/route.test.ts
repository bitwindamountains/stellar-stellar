import { afterEach, describe, expect, it, vi } from 'vitest'
import { lastTab, rememberTab } from './route'

afterEach(() => vi.unstubAllGlobals())

describe('last tab', () => {
  it('defaults to today when nothing is stored', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {} })
    expect(lastTab()).toBe('/')
  })

  it('remembers the last tab', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
    rememberTab('/planned')
    expect(store.get('pp-last-tab')).toBe('/planned')
    expect(lastTab()).toBe('/planned')
  })

  it('survives blocked storage', () => {
    const blocked = () => { throw new Error('SecurityError') }
    vi.stubGlobal('sessionStorage', { getItem: blocked, setItem: blocked })
    expect(() => rememberTab('/history')).not.toThrow()
    expect(lastTab()).toBe('/')
  })
})
