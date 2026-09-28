/**
 * Field normalizers shared by importers.
 */
export { normalize, normalizeOrg, canonicalPersonName } from '@/lib/entity-match'

/** Parse many date shapes to YYYY-MM-DD (or null). Accepts ISO, "M/D/YYYY", "YYYY-MM-DDTHH:mm:ss", "Month D, YYYY". */
export function toIsoDate(v: unknown): string | null {
  if (v == null || v === '') return null
  const s = String(v).trim()
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
  const d = new Date(s)
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return null
}

/** Parse "$1,234.56", "(1,234)", "1234" → number (or null). */
export function toAmount(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return isFinite(v) ? v : null
  const s = String(v).replace(/[$,\s]/g, '')
  const neg = /^\(.*\)$/.test(s)
  const n = Number(s.replace(/[()]/g, ''))
  if (!isFinite(n)) return null
  return neg ? -n : n
}

export function cleanName(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).replace(/\s+/g, ' ').trim()
  return s || null
}

/** "2014-2016" → { start: '2014-01-01', end: '2016-12-31' } */
export function periodRange(p: string | null | undefined): { start: string | null; end: string | null } {
  if (!p) return { start: null, end: null }
  const m = String(p).match(/(\d{4})\D+(\d{4})/) ?? String(p).match(/(\d{4})/)
  if (!m) return { start: null, end: null }
  const a = m[1], b = m[2] ?? m[1]
  return { start: `${a}-01-01`, end: `${b}-12-31` }
}

/** Heuristic: does a raw payer/payee name look like an organization rather than a person? */
export function looksLikeOrg(name: string): boolean {
  const n = name.toLowerCase()
  if (/,\s*[a-z]/i.test(name) && !/\b(inc|llc|ltd|corp|co)\b/.test(n)) return false // "Last, First"
  return /\b(inc|llc|l\.l\.c|ltd|corp|corporation|co\.|company|pac|committee|association|assn|union|local \d|foundation|fund|trust|partners|lp|llp|group|holdings|enterprises|services|bank|church|schools?|university|hawaii|hawaiian|county|state of|department|office of|friends of|citizens|coalition|alliance|council|society|club|center|centre|institute|federation|chamber|realty|construction|electric|gas|energy|hotel|resort|development|properties)\b/.test(n)
}

/** Normalize TMK to 12-digit numeric key (county digit first). Accepts "1-2-3-004-005" or "120030040050000". */
export function normalizeTmk(tmk: string): string {
  const digits = tmk.replace(/\D/g, '')
  return digits.length > 12 ? digits.slice(0, 12) : digits.padEnd(12, '0')
}

/** Normalize a measure number: "SB 1234 HD1" → "SB1234" (drafts dropped). */
export function normalizeMeasure(m: string): string {
  return m.toUpperCase().replace(/\s+/g, '').replace(/(SD|HD|CD)\d+$/i, '')
}
