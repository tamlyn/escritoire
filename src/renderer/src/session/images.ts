import type { ImageAttachment } from '../../../shared/agent'

// Claude scales anything with a longer side down to about this, so sending
// more only costs upload size.
const maxSide = 1568
// The API refuses images over 5 MB, measured as base64.
const maxEncodedLength = 5 * 1024 * 1024
const acceptedTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/** An image file as Claude takes it: an accepted type, no larger than it will use or accept. */
export async function toAttachment(file: Blob): Promise<ImageAttachment> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && acceptedTypes.has(file.type)) {
      const data = await base64(file)
      if (data.length <= maxEncodedLength) return { mediaType: file.type, data }
    }
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)
    // A photo can be too large as PNG and still fit as JPEG.
    for (const type of file.type === 'image/jpeg' ? ['image/jpeg'] : ['image/png', 'image/jpeg']) {
      const data = await base64(await encode(bitmap, width, height, type))
      if (data.length <= maxEncodedLength) return { mediaType: type, data }
    }
    throw new Error('Too large for Claude, even as JPEG.')
  } finally {
    bitmap.close()
  }
}

export function imageFiles(data: DataTransfer): File[] {
  return [...data.files].filter((file) => file.type.startsWith('image/'))
}

function encode(bitmap: ImageBitmap, width: number, height: number, type: string): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')!
  if (type === 'image/jpeg') {
    // JPEG has no transparency, which would otherwise turn black.
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
  }
  context.drawImage(bitmap, 0, 0, width, height)
  return canvas.convertToBlob({ type })
}

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).slice((reader.result as string).indexOf(',') + 1))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
