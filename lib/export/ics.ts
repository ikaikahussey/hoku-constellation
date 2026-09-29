/**
 * iCalendar (RFC 5545) writer for hearing and deadline feeds (E7). UTC times, CRLF line endings,
 * 75-octet line folding, TEXT escaping, stable UIDs, and DTSTAMP on every event.
 */
export interface IcsEvent {
  uid: string
  start: Date
  end?: Date
  /** All-day event on start's UTC date. */
  allDay?: boolean
  summary: string
  description?: string
  location?: string
  url?: string
  categories?: string[]
  status?: 'CONFIRMED' | 'CANCELLED' | 'TENTATIVE'
}

export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const date = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '')

/** Fold a content line at 75 octets (UTF-8), continuation lines start with a single space. */
export function fold(line: string): string {
  const out: string[] = []
  let cur = ''
  let bytes = 0
  for (const ch of line) {
    const b = Buffer.byteLength(ch)
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0 }
    cur += ch
    bytes += b
  }
  out.push(cur)
  return out.join('\r\n ')
}

export function buildCalendar(name: string, events: IcsEvent[], now = new Date()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hoku.fm//HOKU Insider//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`, 'X-WR-TIMEZONE:Pacific/Honolulu', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H']
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${utc(now)}`)
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${date(e.start)}`, `DTEND;VALUE=DATE:${date(new Date(e.start.getTime() + 86_400_000))}`)
    } else {
      lines.push(`DTSTART:${utc(e.start)}`, `DTEND:${utc(e.end ?? new Date(e.start.getTime() + 3600_000))}`)
    }
    lines.push(`SUMMARY:${escapeText(e.summary)}`)
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`)
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`)
    if (e.url) lines.push(`URL:${e.url}`)
    if (e.categories?.length) lines.push(`CATEGORIES:${e.categories.map(escapeText).join(',')}`)
    lines.push(`STATUS:${e.status ?? 'CONFIRMED'}`, 'TRANSP:TRANSPARENT', 'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
