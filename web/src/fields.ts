// Which Composer section each check belongs to, so its message shows under that section (validation.ts wording).
export const SECTIONS = ['media', 'caption', 'where', 'when'] as const
export type Section = (typeof SECTIONS)[number]

const RULES: [Section, RegExp][] = [
  ['where', /Pick an account|Pick at least one platform|has no (Facebook Page|Instagram user) ID|isn't linked/],
  ['when', /Set when to post/],
  ['media', /^(.*: )?Add the |Media link|Google Drive|Only one media|takes videos|A cover|The cover|Cover link|needs an image|needs a JPEG|need a video|Reels need a vertical/],
  ['caption', /caption|hashtags|post is empty|X posts max|titles max/i],
]

export function sectionOf(message: string): Section {
  return RULES.find(([, re]) => re.test(message))?.[0] ?? 'caption'
}

/** Messages grouped by section, in the order the form shows them. */
export function bySection(messages: string[]): Record<Section, string[]> {
  const out = Object.fromEntries(SECTIONS.map((s) => [s, [] as string[]])) as Record<Section, string[]>
  for (const m of messages) out[sectionOf(m)].push(m)
  return out
}
