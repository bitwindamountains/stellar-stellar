// Per-browser conveniences only (remembered choices, unsent draft). Storage can be blocked or cleared,
// so every read falls back and every write is best-effort.
import type { Variants } from './content'
import type { MediaType, Platform } from './types'

export interface Defaults {
  accountId?: number
  platformsByMedia?: Partial<Record<MediaType, Platform[]>>
}

export interface SavedDraft {
  accountId?: number
  platforms: Platform[]
  caption: string
  variants: Variants
  mediaType: MediaType
  mediaUrl: string
  link: string
  mode: 'now' | 'later'
  publishAt: string
  note?: string // shown once when the draft opens
}

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or blocked: losing a convenience is fine.
  }
}

export const loadDefaults = () => read<Defaults>('pp:defaults') ?? {}
export const loadDraft = () => read<SavedDraft>('pp:draft')
export const saveDraft = (draft: SavedDraft | null) => write('pp:draft', draft)

export function rememberChoices(accountId: number, mediaType: MediaType, platforms: Platform[]): void {
  const d = loadDefaults()
  write('pp:defaults', { accountId, platformsByMedia: { ...d.platformsByMedia, [mediaType]: platforms } })
}
