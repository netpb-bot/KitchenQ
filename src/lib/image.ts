/**
 * Shrink a photo before it goes anywhere near the network.
 *
 * A phone camera hands over 4032×3024 and 4 MB. It gets rendered 350px wide
 * behind a card, on a gym's wifi, on a phone. Uploading the original spends the
 * host's upload and every viewer's download on pixels no screen here can show.
 *
 * ponytail: canvas, not a library — the browser already decodes and resamples
 * images. Reach for a real one only if cropping or EXIF rotation lands. The
 * decode half is avatar.ts's `readImage`, which already says the right thing
 * when someone picks a PDF.
 */
import { readImage } from './avatar'

/** Longest edge capped at `max`, aspect preserved. Never upscales. */
export function fitDimensions(w: number, h: number, max: number): { w: number; h: number } {
  const scale = Math.min(1, max / Math.max(w, h))
  // Rounded, and floored at 1: a canvas of zero width throws.
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) }
}

/** Longest edge in CSS pixels. 1200 covers a full-width card on a 3x phone. */
const MAX_EDGE = 1200

/**
 * Decode, resample, re-encode as JPEG at the size the card actually draws.
 *
 * Always JPEG: the bucket only takes JPEG, because unlike webp every browser
 * can encode it and this path has no fallback to offer.
 */
export async function downscale(file: File): Promise<Blob> {
  const bitmap = await readImage(file, 8 * 1024 * 1024)
  const { w, h } = fitDimensions(bitmap.width, bitmap.height, MAX_EDGE)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error("That image couldn't be opened. Try a JPEG or PNG.")
  ctx.drawImage(bitmap, 0, 0, w, h)

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.82),
  )
  if (!blob) throw new Error("That image couldn't be saved. Try another photo.")
  return blob
}
