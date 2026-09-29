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

// ---------------------------------------------------------------- Hawaiʻi ZIP → island

const ZIP_ISLAND: Record<string, string> = {}
const assign = (island: string, zips: number[]) => { for (const z of zips) ZIP_ISLAND[String(z)] = island }
// USPS five-digit ZIPs outside Honolulu's 968xx block. 968xx is always Oʻahu.
assign('Oʻahu', [96701, 96706, 96707, 96709, 96712, 96717, 96730, 96731, 96734, 96744, 96759, 96762, 96782, 96786, 96789, 96791, 96792, 96795, 96797])
assign('Kauaʻi', [96703, 96705, 96714, 96715, 96716, 96722, 96741, 96746, 96747, 96751, 96752, 96754, 96756, 96765, 96766, 96769, 96796])
assign('Maui', [96708, 96713, 96732, 96733, 96753, 96761, 96767, 96768, 96779, 96784, 96788, 96790, 96793])
assign('Molokaʻi', [96729, 96742, 96748, 96757, 96770])
assign('Lānaʻi', [96763])
assign('Hawaiʻi', [96704, 96710, 96718, 96719, 96720, 96721, 96725, 96726, 96727, 96728, 96737, 96738, 96739, 96740, 96743, 96745, 96749, 96750, 96755, 96760, 96764, 96771, 96772, 96773, 96774, 96776, 96777, 96778, 96780, 96781, 96783, 96785])

/**
 * Island for a Hawaiʻi ZIP ("96813", "96813-1234"), spelled as the entity attributes store it
 * ("Oʻahu", "Maui", "Kauaʻi", "Hawaiʻi", "Molokaʻi", "Lānaʻi"). Null for non-Hawaiʻi or unknown ZIPs.
 */
export function islandForZip(zip: unknown): string | null {
  const z = String(zip ?? '').trim().slice(0, 5)
  if (!/^\d{5}$/.test(z)) return null
  if (z.startsWith('968')) return 'Oʻahu'
  return ZIP_ISLAND[z] ?? null
}
