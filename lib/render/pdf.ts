/**
 * PDF renderer (pdf-lib) in the B2 style: black on white, Helvetica-metric sans (Arimo, Apache 2.0,
 * embedded so ʻokina and kahakō render), weights 400/700, red only for links and citations.
 * Arimo ships as latin and latin-ext subsets; runs are split per character across the two faces.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFArray, PDFDocument, PDFName, PDFString, rgb as color, type PDFFont, type PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { tokenRgb, type TokenName } from '@/lib/brand-tokens'
import { SITE_URL } from '@/lib/site'
import { DEFAULT_DISCLAIMER, citationNumbers, orderedSources, type DocModel, type Run } from './model'

const FONT_DIR = join(process.cwd(), 'node_modules', '@fontsource', 'arimo', 'files')
const ink = (n: TokenName) => { const c = tokenRgb(n); return color(c.r, c.g, c.b) }

type Face = 'regular' | 'bold' | 'italic'
interface Fonts { latin: Record<Face, PDFFont>; ext: Record<Face, PDFFont> }

const fontBytes = new Map<string, Uint8Array>()
function fontFile(subset: 'latin' | 'latin-ext', face: Face): Uint8Array {
  const name = `arimo-${subset}-${face === 'bold' ? '700-normal' : face === 'italic' ? '400-italic' : '400-normal'}.woff`
  let b = fontBytes.get(name)
  if (!b) { b = new Uint8Array(readFileSync(join(FONT_DIR, name))); fontBytes.set(name, b) }
  return b
}

/** Characters in the Google Fonts "latin" subset; everything else comes from latin-ext. */
function inLatin(cp: number): boolean {
  return cp <= 0xff || cp === 0x131 || cp === 0x152 || cp === 0x153 || cp === 0x2bb || cp === 0x2bc || cp === 0x2c6 || cp === 0x2da || cp === 0x2dc ||
    (cp >= 0x2000 && cp <= 0x206f) || cp === 0x20ac || cp === 0x2122 || cp === 0x2212 || cp === 0xfeff || cp === 0xfffd
}

interface Piece { text: string; font: PDFFont }
function pieces(text: string, fonts: Fonts, face: Face): Piece[] {
  const out: Piece[] = []
  for (const ch of text) {
    const font = inLatin(ch.codePointAt(0)!) ? fonts.latin[face] : fonts.ext[face]
    const last = out[out.length - 1]
    if (last && last.font === font) last.text += ch
    else out.push({ text: ch, font })
  }
  return out
}
const width = (text: string, fonts: Fonts, face: Face, size: number) => pieces(text, fonts, face).reduce((w, p) => w + p.font.widthOfTextAtSize(p.text, size), 0)

const PAGE = { w: 612, h: 792, margin: 60 }

class Writer {
  page!: PDFPage
  y = 0
  pages: PDFPage[] = []
  constructor(private doc: PDFDocument, public fonts: Fonts, private footer: string) { this.newPage() }
  newPage() {
    this.page = this.doc.addPage([PAGE.w, PAGE.h])
    this.pages.push(this.page)
    this.y = PAGE.h - PAGE.margin
  }
  ensure(h: number) { if (this.y - h < PAGE.margin + 20) this.newPage() }
  text(x: number, y: number, s: string, face: Face, size: number, tone: TokenName = 'ink') {
    let cx = x
    for (const p of pieces(s, this.fonts, face)) {
      this.page.drawText(p.text, { x: cx, y, size, font: p.font, color: ink(tone) })
      cx += p.font.widthOfTextAtSize(p.text, size)
    }
    return cx - x
  }
  link(x: number, y: number, w: number, h: number, url: string) {
    const annot = this.doc.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [x, y - 2, x + w, y + h], Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
    })
    const ref = this.doc.context.register(annot)
    const existing = this.page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (existing) existing.push(ref)
    else this.page.node.set(PDFName.of('Annots'), this.doc.context.obj([ref]))
  }
  rule(weight = 0.5, tone: TokenName = 'rule') {
    this.page.drawLine({ start: { x: PAGE.margin, y: this.y }, end: { x: PAGE.w - PAGE.margin, y: this.y }, thickness: weight, color: ink(tone) })
  }
  finish() {
    const total = this.pages.length
    this.pages.forEach((p, i) => {
      this.page = p
      const label = `${this.footer} · ${i + 1} of ${total}`
      this.text(PAGE.margin, PAGE.margin - 30, label, 'regular', 8, 'muted')
    })
  }
}

interface Token { text: string; face: Face; tone: TokenName; href?: string; space: boolean }

function tokenize(runs: Run[], nums: Map<string, number>): Token[] {
  const out: Token[] = []
  for (const r of runs) {
    const face: Face = r.bold ? 'bold' : r.italic ? 'italic' : 'regular'
    const words = r.text.split(/(\s+)/).filter(w => w.length)
    for (const w of words) {
      if (/^\s+$/.test(w)) { if (out.length) out[out.length - 1].space = true; continue }
      out.push({ text: w, face, tone: r.href ? 'link' : 'ink', href: r.href, space: false })
    }
    for (const c of r.cites ?? []) {
      out.push({ text: `[${nums.get(c) ?? '?'}]`, face: 'regular', tone: 'link', href: `${SITE_URL}/documents/${c}`, space: false })
    }
    if (out.length && (r.cites?.length || /\s$/.test(r.text))) out[out.length - 1].space = true
  }
  return out
}

function paragraph(w: Writer, runs: Run[], nums: Map<string, number>, opts: { size?: number; indent?: number; bullet?: boolean } = {}) {
  const size = opts.size ?? 10.5
  const lead = size * 1.45
  const left = PAGE.margin + (opts.indent ?? 0)
  const right = PAGE.w - PAGE.margin
  const tokens = tokenize(runs, nums)
  const space = width(' ', w.fonts, 'regular', size)
  let line: Array<Token & { w: number }> = []
  let lineW = 0
  const flush = (first: boolean) => {
    w.ensure(lead)
    if (first && opts.bullet) w.text(left - 10, w.y - size, '•', 'regular', size)
    let x = left
    for (const t of line) {
      const tw = w.text(x, w.y - size, t.text, t.face, size, t.tone)
      if (t.href) w.link(x, w.y - size, tw, size, t.href)
      x += tw + (t.space ? space : 0)
    }
    w.y -= lead
    line = []; lineW = 0
  }
  let first = true
  for (const t of tokens) {
    const tw = width(t.text, w.fonts, t.face, size)
    if (line.length && lineW + tw > right - left) { flush(first); first = false }
    line.push({ ...t, w: tw })
    lineW += tw + (t.space ? space : 0)
  }
  if (line.length) flush(first)
  w.y -= size * 0.4
}

function table(w: Writer, header: string[], rows: string[][]) {
  const size = 9
  const colW = (PAGE.w - 2 * PAGE.margin) / Math.max(1, header.length)
  const clip = (s: string) => {
    let t = s
    while (t.length > 1 && width(t, w.fonts, 'regular', size) > colW - 6) t = t.slice(0, -2) + '…'
    return t
  }
  const row = (cells: string[], face: Face) => {
    w.ensure(size * 1.8)
    cells.forEach((c, i) => w.text(PAGE.margin + i * colW, w.y - size, clip(c ?? ''), face, size))
    w.y -= size * 1.6
    w.rule(0.4)
    w.y -= 3
  }
  row(header, 'bold')
  for (const r of rows) row(r, 'regular')
  w.y -= 6
}

export async function renderPdf(model: DocModel): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  doc.setTitle(model.title)
  doc.setProducer('HOKU Insider')
  doc.setCreator('HOKU Insider')
  const load = async (subset: 'latin' | 'latin-ext') => ({
    regular: await doc.embedFont(fontFile(subset, 'regular'), { subset: true }),
    bold: await doc.embedFont(fontFile(subset, 'bold'), { subset: true }),
    italic: await doc.embedFont(fontFile(subset, 'italic'), { subset: true }),
  })
  const fonts: Fonts = { latin: await load('latin'), ext: await load('latin-ext') }
  const w = new Writer(doc, fonts, `HOKU Insider · ${model.title}`)
  const nums = citationNumbers(model)

  // Letterhead: team logo (if uploaded) on the left, publisher on the right, heavy rule.
  let top = w.y
  if (model.logo) {
    const img = model.logo.type === 'png' ? await doc.embedPng(model.logo.bytes) : await doc.embedJpg(model.logo.bytes)
    const h = 36, iw = (img.width / img.height) * h
    w.page.drawImage(img, { x: PAGE.margin, y: top - h, width: Math.min(iw, 200), height: h })
    top -= h + 6
  }
  w.text(PAGE.w - PAGE.margin - width('HOKU Insider', fonts, 'bold', 12), w.y - 12, 'HOKU Insider', 'bold', 12)
  w.y = Math.min(top, w.y - 18)
  w.page.drawLine({ start: { x: PAGE.margin, y: w.y }, end: { x: PAGE.w - PAGE.margin, y: w.y }, thickness: 2, color: ink('ink') })
  w.y -= 28
  paragraph(w, [{ text: model.title, bold: true }], nums, { size: 20 })
  if (model.subtitle) paragraph(w, [{ text: model.subtitle }], nums, { size: 11 })
  const meta = [model.preparedFor ? `Prepared for ${model.preparedFor}` : null, model.preparedBy ? `by ${model.preparedBy}` : null, `Generated ${model.generatedAt.slice(0, 10)}`].filter(Boolean).join(' · ')
  paragraph(w, [{ text: meta }], nums, { size: 9 })
  w.y -= 4

  for (const s of model.sections) {
    w.ensure(40)
    w.y -= 6
    paragraph(w, [{ text: s.heading, bold: true }], nums, { size: 13 })
    w.rule(1, 'ink')
    w.y -= 8
    for (const b of s.blocks) {
      if (b.type === 'p') paragraph(w, b.runs, nums)
      else if (b.type === 'li') paragraph(w, b.runs, nums, { indent: 14, bullet: true })
      else if (b.type === 'table') table(w, b.header, b.rows)
      else paragraph(w, [{ text: b.text, italic: true }], nums, { size: 9.5 })
    }
  }

  const sources = orderedSources(model)
  if (sources.length) {
    w.ensure(40)
    w.y -= 6
    paragraph(w, [{ text: 'Sources', bold: true }], nums, { size: 13 })
    w.rule(1, 'ink')
    w.y -= 8
    for (const s of sources) {
      paragraph(w, [
        { text: `[${nums.get(s.id)}] ` },
        { text: s.title ?? `${s.source} record`, href: `${SITE_URL}/documents/${s.id}` },
        { text: ` — ${s.source.replace(/_/g, ' ')}${s.doc_date ? `, ${s.doc_date}` : ''}` },
      ], nums, { size: 8.5 })
    }
  }
  w.y -= 8
  paragraph(w, [{ text: model.disclaimer ?? DEFAULT_DISCLAIMER, italic: true }], nums, { size: 8 })
  w.finish()
  return doc.save()
}
