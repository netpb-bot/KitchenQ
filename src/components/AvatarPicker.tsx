/**
 * Pick a photo, drag it into place, save it.
 *
 * Opens inline inside the profile's DarkCard rather than as a modal — the same
 * shape the name-and-level form uses, and there is no dialog primitive here to
 * borrow. Zoom is a slider, not a pinch: it works with the one hand that isn't
 * holding the phone, and on a laptop.
 */

import { useEffect, useRef, useState } from 'react'
import { Camera, Trash2 } from 'lucide-react'
import { setMyAvatar, useAction } from '../lib/db'
import {
  MAX_PICK_BYTES,
  MAX_ZOOM,
  canvasToWebp,
  cropRect,
  drawAvatar,
  readImage,
} from '../lib/avatar'
import { Button } from './ui'

/** Preview width in CSS pixels — mirrors `h-56 w-56`, and scales the drag. */
const PREVIEW_PX = 224

export function AvatarPicker({
  hasPhoto,
  onDone,
  onSaved,
}: {
  /** Shows the remove action. */
  hasPhoto: boolean
  onDone: () => void
  onSaved: () => void
}) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [pickError, setPickError] = useState('')
  const [busy, saveError, run] = useAction()

  const canvas = useRef<HTMLCanvasElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)

  // Redraw on every change of crop, at output resolution — so saving is just
  // reading this canvas back, with no second copy of the transform to drift.
  useEffect(() => {
    if (bitmap && canvas.current) drawAvatar(canvas.current, bitmap, scale, offset)
  }, [bitmap, scale, offset])

  // An ImageBitmap holds decoded pixels until it is closed; a few phone photos
  // picked and cancelled is real memory.
  useEffect(() => () => bitmap?.close(), [bitmap])

  async function pick(file: File | undefined) {
    if (!file) return
    setPickError('')
    try {
      const next = await readImage(file, MAX_PICK_BYTES)
      // The effect above closes whichever bitmap this replaces.
      setBitmap(next)
      setScale(1)
      setOffset({ x: 0, y: 0 })
    } catch (e) {
      setPickError(e instanceof Error ? e.message : String(e))
    }
  }

  function pan(e: React.PointerEvent) {
    if (!drag.current || !bitmap) return
    // The preview shows `size` source pixels across `PREVIEW_PX` on screen, so
    // a finger travelling one screen pixel moves the crop by that ratio.
    const perPixel = cropRect(bitmap, scale, offset).size / PREVIEW_PX
    const dx = e.clientX - drag.current.x
    const dy = e.clientY - drag.current.y
    drag.current = { x: e.clientX, y: e.clientY }
    setOffset((o) => ({ x: o.x - dx * perPixel, y: o.y - dy * perPixel }))
  }

  const error = pickError || saveError

  return (
    <div className="kq-rise mt-4 space-y-3 border-t border-white/10 pt-4">
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files?.[0])
          // Cleared so picking the same file twice still fires a change.
          e.target.value = ''
        }}
      />

      {bitmap && (
        <>
          <div className="flex justify-center">
            <canvas
              ref={canvas}
              aria-hidden
              className="h-56 w-56 cursor-grab touch-none rounded-full bg-fill-on-dark active:cursor-grabbing"
              onPointerDown={(e) => {
                drag.current = { x: e.clientX, y: e.clientY }
                e.currentTarget.setPointerCapture(e.pointerId)
              }}
              onPointerMove={pan}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
            />
          </div>
          <label className="block">
            <span className="text-caption font-semibold uppercase text-white/55">
              Zoom
            </span>
            <span className="mt-1 block text-meta text-white/55">
              Drag the picture to choose what sits in the circle.
            </span>
            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.05}
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
              className="mt-2 h-11 w-full accent-brand"
            />
          </label>
        </>
      )}

      {error && (
        <p role="alert" className="text-meta font-medium text-danger-on-dark">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {bitmap ? (
          <Button
            variant="brand"
            loading={busy}
            onClick={() =>
              run(async () => {
                if (!canvas.current) return
                await setMyAvatar(await canvasToWebp(canvas.current))
                onSaved()
              })
            }
          >
            Save photo
          </Button>
        ) : (
          <Button
            variant="brand"
            icon={Camera}
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            Choose a photo
          </Button>
        )}
        {hasPhoto && !bitmap && (
          <Button
            variant="ghostOnDark"
            icon={Trash2}
            loading={busy}
            onClick={() =>
              run(async () => {
                await setMyAvatar(null)
                onSaved()
              })
            }
          >
            Remove
          </Button>
        )}
        <Button type="button" variant="ghostOnDark" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
