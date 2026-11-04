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

/** The clip's length in seconds, rounded up to a tenth (so a hair over a limit still counts as over);
 * null when the browser can't read it or takes over 5 s. */
export function videoSeconds(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(file)
    const finish = (seconds: number | null) => {
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      resolve(seconds)
    }
    const timer = setTimeout(() => finish(null), 5000)
    video.preload = 'metadata'
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) ? Math.ceil(video.duration * 10) / 10 : null)
    video.onerror = () => finish(null)
    video.src = url
  })
}

/** Of a post's own files, the ones no other row uses (group rows and Post again copies share the same files). */
export function unsharedFiles(own: string[], others: { media_urls: string[]; cover_url: string | null }[]): string[] {
  const used = new Set(others.flatMap((o) => [...o.media_urls, o.cover_url ?? '']))
  return own.filter((u) => !used.has(u))
}
