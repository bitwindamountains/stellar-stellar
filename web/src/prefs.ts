// Per-browser conveniences only (remembered choices, unsent draft). Storage can be blocked or cleared,
// so every read falls back and every write is best-effort.
import type { Variants } from './content'
import type { MediaType, Platform } from './types'

/** Where a post goes: platforms per account id. */
export type Targets = Record<number, Platform[]>

export interface Defaults {
  targetsByMedia?: Partial<Record<MediaType, Targets>>
  accountId?: number // older single-account defaults, still read
  platformsByMedia?: Partial<Record<MediaType, Platform[]>>
}

export interface SavedDraft {
  targets?: Targets
  accountId?: number // older drafts
  platforms?: Platform[]
  caption: string
  firstComment?: string
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

/** Remembered targets for a media type, falling back to the older single-account defaults. */
export function rememberedTargets(mediaType: MediaType): Targets | undefined {
  const d = loadDefaults()
  if (d.targetsByMedia?.[mediaType]) return d.targetsByMedia[mediaType]
  const platforms = d.platformsByMedia?.[mediaType]
  return d.accountId && platforms ? { [d.accountId]: platforms } : undefined
}

export function draftTargets(d: SavedDraft): Targets | undefined {
  return d.targets ?? (d.accountId && d.platforms ? { [d.accountId]: d.platforms } : undefined)
}

export function rememberChoices(mediaType: MediaType, targets: Targets): void {
  const d = loadDefaults()
  write('pp:defaults', { targetsByMedia: { ...d.targetsByMedia, [mediaType]: targets } })
}
