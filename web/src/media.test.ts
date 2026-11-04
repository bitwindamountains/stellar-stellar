import { afterEach, describe, expect, it, vi } from 'vitest'
import { unsharedFiles, videoSeconds } from './media'

/** A fake <video> that fires `event` once its src is set. */
function stubVideo(event: 'error' | 'loadedmetadata' | 'none', duration = NaN) {
  const video: Record<string, unknown> = { duration, removeAttribute: vi.fn() }
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

describe('videoSeconds', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('is null when the video cannot be read', async () => {
    stubVideo('error')
    expect(await videoSeconds(file)).toBeNull()
  })

  it('reads the length, rounded up to a tenth', async () => {
    stubVideo('loadedmetadata', 90.01)
    expect(await videoSeconds(file)).toBe(90.1)
  })

  it('gives up after 5 s', async () => {
    vi.useFakeTimers()
    stubVideo('none')
    const seconds = videoSeconds(file)
    vi.advanceTimersByTime(5000)
    expect(await seconds).toBeNull()
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

  it('deletes everything when nothing else uses it', () => {
    expect(unsharedFiles(['https://s/a.mp4', 'https://s/c.jpg'], [])).toEqual(['https://s/a.mp4', 'https://s/c.jpg'])
  })
})
