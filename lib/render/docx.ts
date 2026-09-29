/**
 * DOCX renderer (docx package) in the B2 style: Helvetica/Arial, black text, red hyperlinks for
 * citations and sources, optional team logo in the header.
 */
import { AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, Header, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import { tokenHex } from '@/lib/brand-tokens'
import { SITE_URL } from '@/lib/site'
import { DEFAULT_DISCLAIMER, citationNumbers, orderedSources, type DocModel, type Run } from './model'

const FONT = 'Helvetica'
const INK = tokenHex('ink'), LINK = tokenHex('link'), MUTED = tokenHex('muted'), RULE = tokenHex('rule')

function runs(rs: Run[], nums: Map<string, number>, size = 21) {
  const out: Array<TextRun | ExternalHyperlink> = []
  for (const r of rs) {
    const base = { text: r.text, bold: r.bold, italics: r.italic, font: FONT, size }
    out.push(r.href
      ? new ExternalHyperlink({ link: r.href, children: [new TextRun({ ...base, color: LINK, underline: {} })] })
      : new TextRun({ ...base, color: INK }))
    for (const c of r.cites ?? []) {
      out.push(new ExternalHyperlink({ link: `${SITE_URL}/documents/${c}`, children: [new TextRun({ text: ` [${nums.get(c) ?? '?'}]`, font: FONT, size, color: LINK })] }))
    }
  }
  return out
}

const heading = (text: string, size: number, rule = true) => new Paragraph({
  spacing: { before: 240, after: 120 },
  border: rule ? { bottom: { style: BorderStyle.SINGLE, size: 8, color: INK, space: 4 } } : undefined,
  children: [new TextRun({ text, bold: true, font: FONT, size, color: INK })],
})

export async function renderDocx(model: DocModel): Promise<Uint8Array> {
  const nums = citationNumbers(model)
  const children: Array<Paragraph | Table> = []
  children.push(new Paragraph({ children: [new TextRun({ text: model.title, bold: true, font: FONT, size: 40, color: INK })], spacing: { after: 80 } }))
  if (model.subtitle) children.push(new Paragraph({ children: [new TextRun({ text: model.subtitle, font: FONT, size: 22, color: INK })] }))
  const meta = [model.preparedFor ? `Prepared for ${model.preparedFor}` : null, model.preparedBy ? `by ${model.preparedBy}` : null, `Generated ${model.generatedAt.slice(0, 10)}`].filter(Boolean).join(' · ')
  children.push(new Paragraph({ children: [new TextRun({ text: meta, font: FONT, size: 18, color: MUTED })], spacing: { after: 200 } }))

  for (const s of model.sections) {
    children.push(heading(s.heading, 26))
    for (const b of s.blocks) {
      if (b.type === 'p') children.push(new Paragraph({ children: runs(b.runs, nums), spacing: { after: 120 } }))
      else if (b.type === 'li') children.push(new Paragraph({ children: runs(b.runs, nums), bullet: { level: 0 }, spacing: { after: 60 } }))
      else if (b.type === 'note') children.push(new Paragraph({ children: [new TextRun({ text: b.text, italics: true, font: FONT, size: 19, color: MUTED })] }))
      else {
        const cell = (t: string, bold = false) => new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: t ?? '', bold, font: FONT, size: 18, color: INK })] })],
          borders: { top: { style: BorderStyle.NONE, size: 0, color: RULE }, left: { style: BorderStyle.NONE, size: 0, color: RULE }, right: { style: BorderStyle.NONE, size: 0, color: RULE }, bottom: { style: BorderStyle.SINGLE, size: 4, color: bold ? INK : RULE } },
        })
        children.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [new TableRow({ children: b.header.map(h => cell(h, true)) }), ...b.rows.map(r => new TableRow({ children: r.map(c => cell(c)) }))],
        }))
      }
    }
  }
  const sources = orderedSources(model)
  if (sources.length) {
    children.push(heading('Sources', 26))
    for (const s of sources) {
      children.push(new Paragraph({ spacing: { after: 40 }, children: [
        new TextRun({ text: `[${nums.get(s.id)}] `, font: FONT, size: 17, color: INK }),
        new ExternalHyperlink({ link: `${SITE_URL}/documents/${s.id}`, children: [new TextRun({ text: s.title ?? `${s.source} record`, font: FONT, size: 17, color: LINK, underline: {} })] }),
        new TextRun({ text: ` — ${s.source.replace(/_/g, ' ')}${s.doc_date ? `, ${s.doc_date}` : ''}`, font: FONT, size: 17, color: MUTED }),
      ] }))
    }
  }
  children.push(new Paragraph({ spacing: { before: 240 }, children: [new TextRun({ text: model.disclaimer ?? DEFAULT_DISCLAIMER, italics: true, font: FONT, size: 16, color: MUTED })] }))

  const headerChildren: Paragraph[] = [new Paragraph({
    alignment: AlignmentType.RIGHT,
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: INK, space: 4 } },
    children: [
      ...(model.logo ? [new ImageRun({ type: model.logo.type, data: model.logo.bytes, transformation: { width: 120, height: 36 } }), new TextRun({ text: '   ', font: FONT })] : []),
      new TextRun({ text: 'HOKU Insider', bold: true, font: FONT, size: 22, color: INK }),
    ],
  })]
  const doc = new Document({
    creator: 'HOKU Insider', title: model.title,
    styles: { default: { document: { run: { font: FONT, color: INK } } } },
    sections: [{
      headers: { default: new Header({ children: headerChildren }) },
      footers: { default: new Footer({ children: [new Paragraph({ children: [new TextRun({ text: `HOKU Insider · ${model.title}`, font: FONT, size: 16, color: MUTED })] })] }) },
      children,
    }],
  })
  return new Uint8Array(await Packer.toBuffer(doc))
}
