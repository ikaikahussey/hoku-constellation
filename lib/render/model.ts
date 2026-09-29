/**
 * Shared document model for exported reports, briefings, and dossiers (E3/E4/E7). One model renders
 * to PDF (lib/render/pdf.ts), DOCX (lib/render/docx.ts), and HTML (the in-app view), so every format
 * carries the same text and the same citations.
 */
export interface Run {
  text: string
  bold?: boolean
  italic?: boolean
  href?: string
  /** Document UUIDs cited after this run; rendered as numbered red links to /documents/<id>. */
  cites?: string[]
}

export type Block =
  | { type: 'p'; runs: Run[] }
  | { type: 'li'; runs: Run[] }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'note'; text: string }

export interface Section { heading: string; blocks: Block[] }

export interface SourceDoc { id: string; title: string | null; source: string; doc_date: string | null; url: string | null }

export interface DocModel {
  title: string
  subtitle?: string
  /** Team name for letterhead; "HOKU Insider" is always shown as the publisher. */
  preparedFor?: string
  preparedBy?: string
  logo?: { bytes: Uint8Array; type: 'png' | 'jpg' } | null
  sections: Section[]
  /** Every cited document, numbered in first-cited order. */
  sources: SourceDoc[]
  disclaimer?: string
  generatedAt: string
}

export const DEFAULT_DISCLAIMER =
  'Compiled by HOKU Insider from public records. Every statement cites its source document; verify against the source before relying on it. Not legal advice.'

/** Number sources in first-cited order: document id → 1-based index. */
export function citationNumbers(model: DocModel): Map<string, number> {
  const out = new Map<string, number>()
  const visit = (runs: Run[]) => { for (const r of runs) for (const c of r.cites ?? []) if (!out.has(c)) out.set(c, out.size + 1) }
  for (const s of model.sections) for (const b of s.blocks) if (b.type === 'p' || b.type === 'li') visit(b.runs)
  for (const s of model.sources) if (!out.has(s.id)) out.set(s.id, out.size + 1)
  return out
}

export function orderedSources(model: DocModel): SourceDoc[] {
  const nums = citationNumbers(model)
  return [...model.sources].sort((a, b) => (nums.get(a.id) ?? 1e9) - (nums.get(b.id) ?? 1e9))
}
