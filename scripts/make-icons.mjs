/**
 * Builds the app icons from `KQ Logo.png`.
 *
 * The source is 1254x1254 opaque RGB: a full-bleed dark rounded square with
 * white baked into the four corners. Shipped as-is those white corners read as
 * a rendering fault under every launcher mask, so they are removed here rather
 * than in an image editor — the icons then regenerate from the artwork on
 * demand instead of being untraceable binaries somebody once exported.
 *
 * No dependencies: node:zlib is a PNG codec once you write the twenty lines
 * around it, and pulling in a 40MB image library to resize one file four times
 * is not a trade worth making.
 *
 * Run: npm run icons
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync, inflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(root, 'KQ Logo.png')
const OUT = join(root, 'public')

/** Maskable icons must survive a circular crop: keep the art inside 80%. */
const SAFE_ZONE = 0.8
/** Anything this bright in all three channels is the white the corners sit on. */
const WHITE = 235

/* ------------------------------------------------------------------ decode */

/** A decoded image: 8-bit RGB, no alpha, `data` is w*h*3 bytes. */
function decodePng(bytes) {
  assert.equal(bytes.readUInt32BE(0), 0x89504e47, 'not a PNG')
  let p = 8
  let header = null
  const idat = []

  while (p < bytes.length) {
    const len = bytes.readUInt32BE(p)
    const type = bytes.toString('ascii', p + 4, p + 8)
    if (type === 'IHDR') {
      header = {
        w: bytes.readUInt32BE(p + 8),
        h: bytes.readUInt32BE(p + 12),
        depth: bytes[p + 16],
        color: bytes[p + 17],
        interlace: bytes[p + 20],
      }
    }
    if (type === 'IDAT') idat.push(bytes.subarray(p + 8, p + 8 + len))
    p += 12 + len
    if (type === 'IEND') break
  }

  const { w, h, depth, color, interlace } = header
  assert.equal(depth, 8, 'only 8-bit PNGs are handled')
  assert.equal(interlace, 0, 'interlaced PNGs are not handled')
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[color]
  assert.ok(channels, `unsupported colour type ${color}`)

  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * channels
  const out = Buffer.alloc(h * stride)
  let q = 0

  // Undo the per-scanline filter. Each byte is predicted from its left (a),
  // upper (b) and upper-left (c) neighbours; filter 0 predicts nothing.
  for (let y = 0; y < h; y++) {
    const filter = raw[q++]
    const line = raw.subarray(q, q + stride)
    q += stride
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x
      const a = x >= channels ? out[i - channels] : 0
      const b = y > 0 ? out[i - stride] : 0
      const c = x >= channels && y > 0 ? out[i - stride - channels] : 0
      let v = line[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const pa = Math.abs(b - c)
        const pb = Math.abs(a - c)
        const pc = Math.abs(a + b - 2 * c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      out[i] = v & 255
    }
  }

  // Normalise to RGB so everything downstream has one shape to think about.
  if (channels === 3) return { w, h, data: out }
  const rgb = Buffer.alloc(w * h * 3)
  for (let i = 0, j = 0; i < w * h; i++, j += channels) {
    const grey = channels <= 2
    rgb[i * 3] = grey ? out[j] : out[j]
    rgb[i * 3 + 1] = grey ? out[j] : out[j + 1]
    rgb[i * 3 + 2] = grey ? out[j] : out[j + 2]
  }
  return { w, h, data: rgb }
}

/* ------------------------------------------------------------------ encode */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, body) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(body.length)
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([len, typed, crc])
}

function encodePng({ w, h, data }) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour, no alpha
  // Filter 0 on every scanline. The art is flat colour and large gradients, so
  // the smarter filters buy a few percent for a lot more code.
  const stride = w * 3
  const raw = Buffer.alloc(h * (stride + 1))
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ------------------------------------------------------------------- pixels */

/**
 * Push the white corners off the edge, so the artwork is a full-bleed square
 * that any launcher mask — circle, squircle, rounded rect — can cut cleanly.
 *
 * The corner is a squircle, not a circular radius, so this does not model the
 * shape: it flood-fills the white inward from the four image corners, then
 * replaces each flooded pixel with the first real one along the ray toward the
 * centre. Extending the edge rather than filling flat matters because the
 * background is a gradient — a flat fill leaves a visible seam. Flooding from
 * the corners is what keeps the equally-white "K" out of it.
 */
function squareOff(img) {
  const { w, h, data } = img
  const isWhite = (i) => data[i * 3] > WHITE && data[i * 3 + 1] > WHITE && data[i * 3 + 2] > WHITE

  const corner = new Uint8Array(w * h)
  const stack = [0, w - 1, (h - 1) * w, h * w - 1].filter(isWhite)
  for (const i of stack) corner[i] = 1

  while (stack.length) {
    const i = stack.pop()
    const x = i % w
    const y = (i - x) / w
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const j = ny * w + nx
      if (corner[j] || !isWhite(j)) continue
      corner[j] = 1
      stack.push(j)
    }
  }

  // Sample the plate well inside each corner. Sampling right at the flood
  // boundary instead picks up the anti-aliased ring between white and plate,
  // which averages to grey and fills the corners with the one colour that is
  // obviously wrong.
  // ponytail: flat, not a gradient extension. Every launcher masks the corners
  // off, so the seam this leaves is one nobody can see; fit the gradient only
  // if an unmasked context for these icons ever appears.
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (const [fx, fy] of [[0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]]) {
    const px = Math.round(w * fx)
    const py = Math.round(h * fy)
    assert.ok(!corner[py * w + px], `sample at ${fx},${fy} landed outside the plate`)
    for (let y = py - 10; y <= py + 10; y++) {
      for (let x = px - 10; x <= px + 10; x++) {
        const i = y * w + x
        r += data[i * 3]
        g += data[i * 3 + 1]
        b += data[i * 3 + 2]
        n++
      }
    }
  }
  const fill = [Math.round(r / n), Math.round(g / n), Math.round(b / n)]

  const out = Buffer.from(data)
  for (let i = 0; i < w * h; i++) {
    if (!corner[i]) continue
    out[i * 3] = fill[0]
    out[i * 3 + 1] = fill[1]
    out[i * 3 + 2] = fill[2]
  }
  return { w, h, data: out }
}

/** Box-filter downscale — averaging, so the ball's holes survive at 192px. */
function resize(img, size) {
  const { w, h, data } = img
  const out = Buffer.alloc(size * size * 3)
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor((y * h) / size)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / size))
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor((x * w) / size)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / size))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * w + sx) * 3
          r += data[i]
          g += data[i + 1]
          b += data[i + 2]
          n++
        }
      }
      const o = (y * size + x) * 3
      out[o] = Math.round(r / n)
      out[o + 1] = Math.round(g / n)
      out[o + 2] = Math.round(b / n)
    }
  }
  return { w: size, h: size, data: out }
}

/** The artwork shrunk into the maskable safe zone, on its own background. */
function inset(img, size, fraction) {
  const art = resize(img, Math.round(size * fraction))
  // The background is the artwork's own top-left, which the gradient starts from.
  const bg = [img.data[0], img.data[1], img.data[2]]
  const out = Buffer.alloc(size * size * 3)
  for (let i = 0; i < size * size; i++) {
    out[i * 3] = bg[0]
    out[i * 3 + 1] = bg[1]
    out[i * 3 + 2] = bg[2]
  }
  const off = Math.round((size - art.w) / 2)
  for (let y = 0; y < art.h; y++) {
    art.data.copy(
      out,
      ((y + off) * size + off) * 3,
      y * art.w * 3,
      (y + 1) * art.w * 3,
    )
  }
  return { w: size, h: size, data: out }
}

/* ---------------------------------------------------------------------- run */

const source = squareOff(decodePng(readFileSync(SOURCE)))

const targets = [
  ['icon-192.png', resize(source, 192)],
  ['icon-512.png', resize(source, 512)],
  ['icon-maskable-512.png', inset(source, 512, SAFE_ZONE)],
  // iOS ignores SVG favicons, so without this there is no home-screen icon.
  ['apple-touch-icon.png', resize(source, 180)],
  ['favicon-32.png', resize(source, 32)],
]

for (const [name, img] of targets) {
  const file = join(OUT, name)
  writeFileSync(file, encodePng(img))

  // Read back what we just wrote rather than trusting the encoder: a silently
  // corrupt icon is invisible until someone installs the app.
  const check = decodePng(readFileSync(file))
  assert.equal(check.w, img.w, `${name}: width`)
  assert.equal(check.h, img.h, `${name}: height`)
  assert.deepEqual(check.data, img.data, `${name}: pixels survived the round trip`)

  const corner = [0, 1, 2].map((c) => check.data[c])
  assert.ok(
    corner.some((v) => v < 200),
    `${name}: corner is still near-white (${corner}) — squareOff did not take`,
  )

  console.log(`  ${name.padEnd(24)} ${img.w}x${img.h}  ${readFileSync(file).length} bytes`)
}

console.log(`\n${targets.length} icons written to public/`)
