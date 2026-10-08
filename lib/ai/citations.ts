/**
 * Citation rules for every model-written sentence in reports, briefings, dossiers, and Q&A (E3/E4/E5).
 *
 *   - The model receives only structured facts, each tagged with a short handle (D1, D2, …) that maps
 *     to a document UUID.
 *   - Output is a list of sentences, each with the handles it relies on.
 *   - The validator rejects the whole output if any sentence is uncited, cites a handle that was not
 *     supplied, or packs more than one sentence into a sentence slot.
 *
 * `validateCitedText` applies the same rule to free text with inline [D1] markers (used for edited
 * narratives and for golden-file fixtures).
 */

export interface CitedSentence { text: string; cites: string[] }

export interface Fact {
  /** Stable handle shown to the model, e.g. "D3". Assigned by `assignHandles`. */
  handle?: string
  documentId: string
  /** One line of plain fact, e.g. "HB 123 passed Second Reading on 2027-02-20." */
  text: string
  date?: string | null
  kind?: string
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
  /** Sentences with handles resolved to document UUIDs (only when ok). */
  sentences: Array<{ text: string; documentIds: string[] }>
}

export function assignHandles(facts: Fact[]): { facts: Array<Fact & { handle: string }>; byHandle: Map<string, string> } {
  const byHandle = new Map<string, string>()
  const byDoc = new Map<string, string>()
  const out = facts.map(f => {
    let h = byDoc.get(f.documentId)
    if (!h) {
      h = `D${byDoc.size + 1}`
      byDoc.set(f.documentId, h)
      byHandle.set(h, f.documentId)
    }
    return { ...f, handle: h }
  })
  return { facts: out, byHandle }
}

const ABBREV = /\b(No|Nos|Rep|Reps|Sen|Gov|Lt|Gen|Atty|Hon|Capt|Sgt|Supt|Stand|Com|Conf|Inc|Co|Corp|Ltd|Dept|St|Mr|Ms|Mrs|Dr|U\.S|H\.B|S\.B|v|vs|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\./g

/**
 * Segment prose into sentences, keeping any [D1]-style markers that follow a sentence attached to it.
 * Abbreviations (Stand. Com. Rep. No.) and decimals do not end a sentence.
 */
function segment(text: string): string[] {
  const p = text.replace(ABBREV, '$1\u0000').replace(/(\d)\.(\d)/g, '$1\u0000$2')
  const out: string[] = []
  const re = /[^.!?]*?[.!?]+["”’)]*(?:\s*\[[^\]]*\])*(?=\s+|$)/gy
  let i = 0
  while (i < p.length) {
    re.lastIndex = i
    const m = re.exec(p)
    if (!m || !m[0]) { out.push(p.slice(i)); break }
    out.push(m[0])
    i = re.lastIndex
    while (i < p.length && /\s/.test(p[i])) i++
  }
  return out.map(s => s.replace(/\u0000/g, '.').trim()).filter(Boolean)
}

/** Split prose into sentences (citation markers stripped). */
export function splitSentences(text: string): string[] {
  return segment(text).map(s => s.replace(HANDLE, '').trim()).filter(Boolean)
}

const HANDLE = /\[((?:D\d+)(?:\s*,\s*D\d+)*)\]/g

/** Validate structured model output. */
export function validateCitedSentences(sentences: CitedSentence[], byHandle: Map<string, string>): ValidationResult {
  const errors: string[] = []
  const resolved: ValidationResult['sentences'] = []
  if (!Array.isArray(sentences) || sentences.length === 0) errors.push('no sentences')
  for (const [i, s] of (sentences ?? []).entries()) {
    const text = (s?.text ?? '').replace(HANDLE, '').replace(/\s+/g, ' ').trim()
    if (!text) { errors.push(`sentence ${i + 1} is empty`); continue }
    const parts = splitSentences(text)
    if (parts.length > 1) errors.push(`sentence ${i + 1} contains ${parts.length} sentences; each needs its own citations`)
    const cites = [...new Set((s.cites ?? []).map(c => String(c).trim().toUpperCase()))]
    if (!cites.length) errors.push(`sentence ${i + 1} has no citation: "${text.slice(0, 80)}"`)
    const unknown = cites.filter(c => !byHandle.has(c))
    if (unknown.length) errors.push(`sentence ${i + 1} cites unknown source(s) ${unknown.join(', ')}`)
    resolved.push({ text, documentIds: cites.filter(c => byHandle.has(c)).map(c => byHandle.get(c)!) })
  }
  return { ok: errors.length === 0, errors, sentences: errors.length ? [] : resolved }
}

/** Validate free text with inline [D1] / [D1, D2] markers after each sentence. */
export function validateCitedText(text: string, byHandle: Map<string, string>): ValidationResult {
  return validateCitedSentences(segment(text).map(toCited), byHandle)
}

function toCited(s: string): CitedSentence {
  const cites: string[] = []
  for (const m of s.matchAll(HANDLE)) cites.push(...m[1].split(/\s*,\s*/))
  return { text: s.replace(HANDLE, '').trim(), cites }
}

/** Render resolved sentences back to marker text (for the editor). */
export function toMarkerText(sentences: Array<{ text: string; documentIds: string[] }>, byDoc: Map<string, string>): string {
  return sentences.map(s => `${s.text} ${s.documentIds.map(d => `[${byDoc.get(d) ?? d}]`).join('')}`).join(' ')
}
