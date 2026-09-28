#!/usr/bin/env node
/**
 * Generates app/favicon.ico (32×32 + 16×16 PNG-in-ICO) from the Mark geometry in
 * components/brand/Wordmark.tsx: black square, white "H". No image libraries — the H is rectilinear,
 * so it is rasterized directly and encoded with zlib.
 *
 *   node scripts/brand/gen-favicon.mjs
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

// Mark path on a 64-unit grid: M16 12h10v16h12V12h10v40H38V36H26v16H16z → three white rectangles.
const RECTS = [[16, 12, 10, 40], [38, 12, 10, 40], [26, 28, 12, 8]]

function raster(size) {
  const px = new Uint8Array(size * size * 4)
  const s = size / 64
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const ux = (x + 0.5) / s, uy = (y + 0.5) / s
    const white = RECTS.some(([rx, ry, rw, rh]) => ux >= rx && ux < rx + rw && uy >= ry && uy < ry + rh)
    const i = (y * size + x) * 4
    px[i] = px[i + 1] = px[i + 2] = white ? 255 : 0
    px[i + 3] = 255
  }
  return px
}

const CRC_TABLE = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c })
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0 }
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function png(size) {
  const px = raster(size)
  const rows = []
  for (let y = 0; y < size; y++) { rows.push(Buffer.from([0])); rows.push(Buffer.from(px.subarray(y * size * 4, (y + 1) * size * 4))) }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}

function ico(sizes) {
  const images = sizes.map(png)
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4)
  const dir = []
  let offset = 6 + 16 * images.length
  images.forEach((img, i) => {
    const e = Buffer.alloc(16)
    e[0] = sizes[i] === 256 ? 0 : sizes[i]; e[1] = sizes[i] === 256 ? 0 : sizes[i]; e[2] = 0; e[3] = 0
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(img.length, 8); e.writeUInt32LE(offset, 12)
    offset += img.length
    dir.push(e)
  })
  return Buffer.concat([header, ...dir, ...images])
}

const out = new URL('../../app/favicon.ico', import.meta.url)
writeFileSync(out, ico([16, 32, 48]))
console.log(`wrote ${out.pathname}`)
