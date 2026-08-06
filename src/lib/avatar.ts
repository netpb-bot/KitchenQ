/**
 * Turning a photo off a phone into a 256px square, with no dependency.
 *
 * The arithmetic lives here rather than in the component so it can be tested
 * without a DOM — the same split queue.ts and standings.ts use.
 */

/**
 * The square is drawn at 80px at most (`xl` in Avatar), so 256 covers a 3x
 * screen. Bigger buys nothing anyone can see and costs everyone's data on a
 * roster of sixteen.
 */
export const AVATAR_PX = 256

/**
 * What the avatars bucket accepts. This is a ceiling on the *encoded* 256px
 * WebP, which comes out around 20KB — it is not what someone may pick.
 */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024

/**
 * What someone may pick. Far larger than the bucket's limit, because nothing
 * they choose is ever uploaded: it is cropped and re-encoded first. The only
 * thing this protects is a phone being asked to decode something enormous —
 * a 48MP JPEG off a recent camera is about 12MB.
 */
export const MAX_PICK_BYTES = 12 * 1024 * 1024

/** How far in the zoom slider goes. Past this a phone photo starts to mush. */
export const MAX_ZOOM = 4

export type Natural = { width: number; height: number }
export type Offset = { x: number; y: number }

/**
 * Which square of the source image ends up in the circle.
 *
 * `scale` 1 means the image's shorter side exactly fills the square — the
 * plain centre crop. `offset` is a pan in *source* pixels, clamped so the
 * window can never run off the image and leave a blank edge.
 */
export function cropRect(
  natural: Natural,
  scale: number,
  offset: Offset,
): { sx: number; sy: number; size: number } {
  // Whole source pixels: at a zoom like 3x the fractional window drifted a
  // hair past the far edge, and a rect that doesn't quite fit its own image is
  // a hard thing to trust later.
  const size = Math.floor(Math.min(natural.width, natural.height) / Math.max(1, scale))
  const place = (centre: number, extent: number) =>
    Math.round(Math.min(Math.max(centre - size / 2, 0), extent - size))
  return {
    sx: place(natural.width / 2 + offset.x, natural.width),
    sy: place(natural.height / 2 + offset.y, natural.height),
    size,
  }
}

/**
 * Decode a picked file, rejecting what the bucket would reject anyway. The
 * bucket's own limits are the enforcement; these two checks exist so the
 * failure arrives as a sentence instead of a 400.
 *
 * `maxBytes` is a parameter because a session photo is downscaled before it is
 * uploaded, so its ceiling is about what a phone can decode without stalling,
 * not about what its bucket accepts.
 */
export async function readImage(file: File, maxBytes = MAX_UPLOAD_BYTES): Promise<ImageBitmap> {
  if (!file.type.startsWith('image/')) throw new Error('That file is not an image.')
  if (file.size > maxBytes) {
    const mb = (limit: number) => Math.round(limit / 1024 / 1024)
    throw new Error(`That photo is ${mb(file.size)}MB — pick one under ${mb(maxBytes)}MB.`)
  }
  try {
    return await createImageBitmap(file)
  } catch {
    throw new Error("That image couldn't be opened. Try a JPEG or PNG.")
  }
}

/** Paint the current crop at output resolution, so saving is just toBlob. */
export function drawAvatar(
  canvas: HTMLCanvasElement,
  bitmap: ImageBitmap,
  scale: number,
  offset: Offset,
): void {
  canvas.width = AVATAR_PX
  canvas.height = AVATAR_PX
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { sx, sy, size } = cropRect(bitmap, scale, offset)
  ctx.clearRect(0, 0, AVATAR_PX, AVATAR_PX)
  ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, AVATAR_PX, AVATAR_PX)
}

export function canvasToWebp(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        // The bucket only accepts image/webp. A browser that can't encode it
        // hands back a PNG here rather than failing, which would upload and be
        // rejected with nothing useful to say.
        if (blob?.type === 'image/webp') resolve(blob)
        else reject(new Error("This browser can't save photos. Try Chrome or Safari."))
      },
      'image/webp',
      0.85,
    )
  })
}
