/**
 * Hawaiʻi time helpers. Pacific/Honolulu is UTC−10 with no daylight saving, so fixed-offset math is exact.
 */
const HST_OFFSET_MS = 10 * 60 * 60 * 1000

/** Minutes since local midnight in Honolulu. */
export function hstMinutes(d: Date): number {
  const local = new Date(d.getTime() - HST_OFFSET_MS)
  return local.getUTCHours() * 60 + local.getUTCMinutes()
}

export function hstDay(d: Date): number {
  return new Date(d.getTime() - HST_OFFSET_MS).getUTCDay()
}

const toMinutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0) }

/** Is `d` inside the [start, end) quiet window? Windows may wrap midnight (e.g. 21:00–07:00). */
export function inQuietHours(d: Date, start: string | null | undefined, end: string | null | undefined): boolean {
  if (!start || !end) return false
  const s = toMinutes(start), e = toMinutes(end), n = hstMinutes(d)
  if (s === e) return false
  return s < e ? n >= s && n < e : n >= s || n < e
}

/** The instant the current quiet window ends. */
export function quietEnd(d: Date, end: string): Date {
  const e = toMinutes(end)
  const n = hstMinutes(d)
  const delta = ((e - n) + 24 * 60) % (24 * 60) || 24 * 60
  const out = new Date(d.getTime() + delta * 60_000)
  out.setUTCSeconds(0, 0)
  return out
}

/** Next local HH:MM in Honolulu at or after `d`, optionally on a given weekday (0 = Sunday). */
export function nextLocalTime(d: Date, hhmm: string, weekday?: number): Date {
  const target = toMinutes(hhmm)
  const localMidnight = new Date(d.getTime() - HST_OFFSET_MS)
  localMidnight.setUTCHours(0, 0, 0, 0)
  for (let i = 0; i < 8; i++) {
    const candidate = new Date(localMidnight.getTime() + i * 86_400_000 + target * 60_000 + HST_OFFSET_MS)
    if (candidate.getTime() < d.getTime()) continue
    if (weekday != null && hstDay(candidate) !== weekday) continue
    return candidate
  }
  throw new Error('unreachable')
}

export const DAILY_DIGEST_TIME = '07:00'
export const WEEKLY_DIGEST_DAY = 1 // Monday
export function digestTime(channel: 'digest_daily' | 'digest_weekly', now: Date): Date {
  return channel === 'digest_daily' ? nextLocalTime(now, DAILY_DIGEST_TIME) : nextLocalTime(now, DAILY_DIGEST_TIME, WEEKLY_DIGEST_DAY)
}
