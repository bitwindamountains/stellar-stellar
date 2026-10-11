// Android share target: the service worker parks a shared file here, the composer takes it once.
export const SHARE_CACHE = 'postpilot-share'

export async function takeShared(): Promise<{ file?: File; text: string } | null> {
  try {
    const cache = await caches.open(SHARE_CACHE)
    const meta = await cache.match('/shared-meta')
    if (!meta) return null
    const { name, type, text } = (await meta.json()) as { name?: string; type?: string; text: string }
    const media = await cache.match('/shared-media')
    const file = media && name ? new File([await media.blob()], name, { type }) : undefined
    await Promise.all([cache.delete('/shared-meta'), cache.delete('/shared-media')])
    return { file, text }
  } catch {
    return null // no Cache API (e.g. private mode): nothing to take
  }
}
