// Instagram only accepts JPEG, so PNG/WebP uploads are re-encoded in the browser before uploading.
export async function toJpeg(file: File): Promise<File> {
  if (!/^image\/(png|webp)$/.test(file.type)) return file
  try {
    const bitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.fillStyle = '#ffffff' // JPEG has no transparency: put see-through areas on white, not black
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file
  } catch {
    return file // can't decode it here: upload as-is and let the checks flag it for Instagram
  }
}

/** What the composer checks about a clip; each is null when the browser can't read it. Keys match Draft. */
export interface VideoMeta {
  videoSeconds: number | null
  videoWidth: number | null
  videoHeight: number | null
}

export const NO_VIDEO_META: VideoMeta = { videoSeconds: null, videoWidth: null, videoHeight: null }

/** The clip's length in seconds, rounded up to a tenth (so a hair over a limit still counts as over), and its
 * size in pixels; all null when the browser can't read it or takes over 5 s. */
export function videoMeta(file: File): Promise<VideoMeta> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(file)
    const finish = (meta: VideoMeta) => {
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      resolve(meta)
    }
    const timer = setTimeout(() => finish(NO_VIDEO_META), 5000)
    video.preload = 'metadata'
    video.onloadedmetadata = () =>
      finish({
        videoSeconds: Number.isFinite(video.duration) ? Math.ceil(video.duration * 10) / 10 : null,
        videoWidth: video.videoWidth || null,
        videoHeight: video.videoHeight || null,
      })
    video.onerror = () => finish(NO_VIDEO_META)
    video.src = url
  })
}
