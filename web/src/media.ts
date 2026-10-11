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
