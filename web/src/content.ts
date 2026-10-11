// Mirror of Post.text_for / title_for in src/postpilot/models.py. Keep the two in step.
import type { Platform } from './types'

export interface Variant {
  caption?: string
  hashtags?: string
  title?: string
}
export type Variants = Partial<Record<Platform, Variant>>

/** The platform's caption override (or the base caption), then its hashtags line. */
export function textFor(base: string, variants: Variants, p: Platform): string {
  const v = variants[p] ?? {}
  const caption = v.caption?.trim() || base.trim()
  return [caption, v.hashtags?.trim() ?? ''].filter(Boolean).join('\n\n')
}

export function titleFor(variants: Variants, p: Platform): string {
  return variants[p]?.title?.trim() ?? ''
}

export function isCustomized(variants: Variants, p: Platform): boolean {
  const v = variants[p]
  return !!(v?.caption?.trim() || v?.hashtags?.trim() || v?.title?.trim())
}

/** Drops blank fields and platforms that aren't selected, so the stored object stays small. */
export function cleanVariants(variants: Variants, platforms: Platform[]): Variants {
  const out: Variants = {}
  for (const p of platforms) {
    const v = variants[p]
    if (!v) continue
    const kept = Object.fromEntries(Object.entries(v).filter(([, value]) => value?.trim())) as Variant
    if (Object.keys(kept).length) out[p] = kept
  }
  return out
}
