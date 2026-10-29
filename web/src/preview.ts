// What each platform will show, built from the same text the publisher sends (content.ts, validation.ts).
import { textFor, titleFor, type Variants } from './content'
import type { Platform } from './types'
import { xLength, xText, X_TEXT_MAX } from './validation'

export const IG_FOLD = 125 // Instagram's feed shows about this much before "… more"

export interface PreviewText {
  title: string
  text: string // what's visible before any "more"
  more: boolean // the rest hides behind "… more"
  count?: { used: number; max: number }
}

export function previewText(p: Platform, d: { caption: string; variants: Variants; link: string }): PreviewText {
  const title = titleFor(d.variants, p)
  if (p === 'x') return { title, text: xText(d), more: false, count: { used: xLength(xText(d)), max: X_TEXT_MAX } }
  const full = [textFor(d.caption, d.variants, p), p === 'facebook' || p === 'fb_profile' ? d.link : ''].filter(Boolean).join('\n\n')
  if (p === 'instagram' && full.length > IG_FOLD) return { title, text: full.slice(0, IG_FOLD).trimEnd(), more: true }
  return { title, text: full, more: false }
}
