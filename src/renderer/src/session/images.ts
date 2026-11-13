import type { ImageAttachment } from '../../../shared/agent'

// Claude scales anything with a longer side down to about this, so sending
// more only costs upload size and risks the API's 5 MB limit.
const maxSide = 1568
const acceptedTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/** An image file as Claude takes it: an accepted type, no larger than it will use. */
export async function toAttachment(file: Blob): Promise<ImageAttachment> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && acceptedTypes.has(file.type)) {
    bitmap.close()
    return { mediaType: file.type, data: await base64(file) }
  }
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale))
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
  return { mediaType: type, data: await base64(await canvas.convertToBlob({ type })) }
}

export function imageFiles(data: DataTransfer): File[] {
  return [...data.files].filter((file) => file.type.startsWith('image/'))
}

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).slice((reader.result as string).indexOf(',') + 1))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
