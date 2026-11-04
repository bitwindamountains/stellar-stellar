import { afterEach, describe, expect, it, vi } from 'vitest'
import { NO_VIDEO_META, unsharedFiles, videoMeta } from './media'

/** A fake <video> that fires `event` once its src is set. */
function stubVideo(event: 'error' | 'loadedmetadata' | 'none', duration = NaN, videoWidth = 0, videoHeight = 0) {
  const video: Record<string, unknown> = { duration, videoWidth, videoHeight, removeAttribute: vi.fn() }
  Object.defineProperty(video, 'src', {
    set() {
      if (event === 'error') (video.onerror as () => void)()
      if (event === 'loadedmetadata') (video.onloadedmetadata as () => void)()
    },
  })
  vi.stubGlobal('document', { createElement: () => video })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
}

const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' })

describe('videoMeta', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('is null when the video cannot be read', async () => {
    stubVideo('error')
    expect(await videoMeta(file)).toEqual(NO_VIDEO_META)
  })

  it('reads the length, rounded up to a tenth, and the size', async () => {
    stubVideo('loadedmetadata', 90.01, 1080, 1920)
    expect(await videoMeta(file)).toEqual({ videoSeconds: 90.1, videoWidth: 1080, videoHeight: 1920 })
  })

  it('leaves an unreadable size null', async () => {
    stubVideo('loadedmetadata', 10)
    expect(await videoMeta(file)).toEqual({ videoSeconds: 10, videoWidth: null, videoHeight: null })
  })

  it('gives up after 5 s', async () => {
    vi.useFakeTimers()
    stubVideo('none')
    const meta = videoMeta(file)
    vi.advanceTimersByTime(5000)
    expect(await meta).toEqual(NO_VIDEO_META)
  })
})

describe('unsharedFiles', () => {
  it('keeps files another row still uses, in its media or as its cover', () => {
    const others = [
      { media_urls: ['https://s/clip.mp4'], cover_url: '' },
      { media_urls: [], cover_url: 'https://s/cover.jpg' },
    ]
    expect(unsharedFiles(['https://s/clip.mp4', 'https://s/cover.jpg', 'https://s/own.jpg'], others)).toEqual(['https://s/own.jpg'])
  })

  it('ignores rows that are posted and handed off: they no longer need the file', () => {
    const others = [{ media_urls: ['https://s/clip.mp4'], cover_url: '', status: 'posted', assist_done_at: '2026-11-04T00:00:00Z' }]
    expect(unsharedFiles(['https://s/clip.mp4'], others)).toEqual(['https://s/clip.mp4'])
    expect(unsharedFiles(['https://s/clip.mp4'], [{ ...others[0], assist_done_at: null }])).toEqual([])
  })

  it('deletes everything when nothing else uses it', () => {
    expect(unsharedFiles(['https://s/a.mp4', 'https://s/c.jpg'], [])).toEqual(['https://s/a.mp4', 'https://s/c.jpg'])
  })
})
