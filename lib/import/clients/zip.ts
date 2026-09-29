/**
 * Minimal ZIP reader for bulk data files (SEC Form D data sets): stored and deflated entries, no ZIP64,
 * no encryption. Uses node:zlib only, so no dependency is added.
 */
import { inflateRawSync } from 'node:zlib'

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

/** Entries of a ZIP archive, optionally filtered by name; directories are skipped. */
export function unzip(buf: Buffer, want?: (name: string) => boolean): Map<string, Buffer> {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('unzip: end of central directory not found (not a ZIP file?)')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out = new Map<string, Buffer>()
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== CENTRAL) throw new Error('unzip: malformed central directory')
    const method = buf.readUInt16LE(p + 10)
    const compressed = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    p += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/') || (want && !want(name))) continue
    if (compressed === 0xffffffff || localOffset === 0xffffffff) throw new Error(`unzip: ${name} needs ZIP64, which is not supported`)
    if (buf.readUInt32LE(localOffset) !== LOCAL) throw new Error(`unzip: malformed local header for ${name}`)
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28)
    const data = buf.subarray(start, start + compressed)
    if (method === 0) out.set(name, Buffer.from(data))
    else if (method === 8) out.set(name, inflateRawSync(data))
    else throw new Error(`unzip: ${name} uses unsupported compression method ${method}`)
  }
  return out
}

/**
 * Tab-separated values with a header row. A field that starts with a double quote is quoted
 * ("" escapes a quote inside it); quotes elsewhere are literal. CRLF and LF line endings.
 */
export function parseTsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false, atStart = true
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false }
      else field += c
      continue
    }
    if (c === '"' && atStart) { quoted = true; atStart = false; continue }
    if (c === '\t') { row.push(field); field = ''; atStart = true; continue }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''; atStart = true
      continue
    }
    field += c; atStart = false
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const [header, ...body] = rows.filter(r => r.some(v => v.trim()))
  if (!header) return []
  const keys = header.map(h => h.trim())
  return body.map(r => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])))
}
