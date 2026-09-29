/**
 * Per-user ICS feed of hearings and testimony deadlines for watched bills (E7). The feed URL holds a
 * random secret; only its SHA-256 is stored (app.user_pref.ics_token_hash). Rotating issues a new
 * secret and the old URL stops working immediately.
 */
import type { Db } from '@/lib/db/types'
import { hashToken, newToken } from '@/lib/teams'
import { classifyStatus } from '@/lib/alerts/events'
import { buildCalendar, type IcsEvent } from './ics'
import { SITE_URL } from '@/lib/site'

export async function rotateCalendarToken(db: Db, userId: string): Promise<string> {
  const token = newToken()
  await db.query(
    `insert into app.user_pref(user_id, ics_token_hash, ics_rotated_at) values ($1, $2, now())
     on conflict (user_id) do update set ics_token_hash = excluded.ics_token_hash, ics_rotated_at = now()`, [userId, hashToken(token)])
  return token
}

export const calendarUrl = (token: string) => `${SITE_URL}/api/calendar/${token}.ics`

export async function userForCalendarToken(db: Db, token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null
  return (await db.one<{ user_id: string }>(`select user_id from app.user_pref where ics_token_hash = $1`, [hashToken(token)]))?.user_id ?? null
}

export async function calendarEvents(db: Db, userId: string, now = new Date()): Promise<IcsEvent[]> {
  const bills = await db.many<{ id: string; name: string; current_status: string | null; title: string | null }>(
    `select distinct e.id, e.name, e.attributes->>'current_status' current_status, e.attributes->>'title' title
       from app.team_member m join app.watchlist w on w.team_id = m.team_id join app.watchlist_item i on i.watchlist_id = w.id
       join entity e on e.id = i.entity_id
      where m.user_id = $1 and m.joined_at is not null and m.removed_at is null and e.kind = 'bill'
      order by e.name`, [userId])
  const events: IcsEvent[] = []
  for (const b of bills) {
    if (!b.current_status) continue
    const c = classifyStatus(b.current_status)
    if (!c.hearingAt || c.hearingAt.getTime() < now.getTime() - 30 * 86_400_000) continue
    const url = `${SITE_URL}/bills/${b.id}`
    const room = b.current_status.match(/(?:conference room|room)\s+([\w&-]+)/i)?.[1]
    const cancelled = c.type === 'bill.hearing_canceled'
    const committees = c.committees.join('/') || 'Committee'
    events.push({
      uid: `hearing-${b.id}-${c.hearingAt.toISOString()}@constellation.hoku.fm`, start: c.hearingAt, end: new Date(c.hearingAt.getTime() + 2 * 3600_000),
      summary: `${cancelled ? 'CANCELED: ' : ''}${committees} hearing: ${b.name}`, description: `${b.title ?? ''}\n${b.current_status}\n${url}`.trim(),
      location: room ? `State Capitol, Room ${room}` : 'Hawaiʻi State Capitol', url, categories: ['Hearing'], status: cancelled ? 'CANCELLED' : 'CONFIRMED',
    })
    if (!cancelled) {
      events.push({
        uid: `testimony-deadline-${b.id}-${c.hearingAt.toISOString()}@constellation.hoku.fm`, start: new Date(c.hearingAt.getTime() - 24 * 3600_000),
        end: new Date(c.hearingAt.getTime() - 24 * 3600_000 + 15 * 60_000),
        summary: `Testimony due: ${b.name} (${committees})`, description: `Written testimony is due 24 hours before the hearing.\n${url}`, url, categories: ['Deadline'],
      })
    }
  }
  return events
}

export async function userCalendar(db: Db, userId: string, now = new Date()): Promise<string> {
  return buildCalendar('HOKU Insider — hearings and deadlines', await calendarEvents(db, userId, now), now)
}
