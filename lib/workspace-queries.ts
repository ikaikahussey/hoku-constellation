/**
 * Read models for workspace pages: watched bills with hearing/deadline dates, hearings this week,
 * recent alerts, onboarding progress.
 */
import type { Db } from '@/lib/db/types'
import { classifyStatus } from '@/lib/alerts/events'

export interface WatchedBill {
  id: string; name: string; measure: string | null; title: string | null; status: string | null; referral: string | null
  position: string | null; watchlists: string; nextHearing: Date | null; testimonyDue: Date | null; canceled: boolean
}

export async function watchedBills(db: Db, teamId: string, now = new Date()): Promise<WatchedBill[]> {
  const rows = await db.many<{ id: string; name: string; measure: string | null; title: string | null; status: string | null; referral: string | null; position: string | null; watchlists: string }>(
    `select e.id, e.name, e.attributes->>'measure_number' measure, e.attributes->>'title' title, e.attributes->>'current_status' status,
            e.attributes->>'current_referral' referral, string_agg(distinct i.position, ', ') position, string_agg(distinct w.name, ', ') watchlists
       from app.watchlist w join app.watchlist_item i on i.watchlist_id = w.id join entity e on e.id = i.entity_id
      where w.team_id = $1 and e.kind = 'bill' group by e.id order by e.name`, [teamId])
  return rows.map(r => {
    const c = r.status ? classifyStatus(r.status) : null
    const upcoming = c?.hearingAt && c.hearingAt > now && c.type !== 'bill.hearing_canceled' ? c.hearingAt : null
    return { ...r, nextHearing: upcoming, testimonyDue: upcoming ? new Date(upcoming.getTime() - 864e5) : null, canceled: c?.type === 'bill.hearing_canceled' }
  })
}

export function sortBills(bills: WatchedBill[], sort: string): WatchedBill[] {
  const t = (d: Date | null) => d?.getTime() ?? Number.MAX_SAFE_INTEGER
  const by: Record<string, (a: WatchedBill, b: WatchedBill) => number> = {
    status: (a, b) => (a.status ?? '').localeCompare(b.status ?? ''),
    hearing: (a, b) => t(a.nextHearing) - t(b.nextHearing),
    deadline: (a, b) => t(a.testimonyDue) - t(b.testimonyDue),
    measure: (a, b) => (a.measure ?? a.name).localeCompare(b.measure ?? b.name, undefined, { numeric: true }),
  }
  return [...bills].sort(by[sort] ?? by.measure)
}

export const hst = (d: Date) => new Date(d.getTime() - 36e6).toISOString().replace('T', ' ').slice(0, 16) + ' HST'

export async function recentAlerts(db: Db, teamId: string, limit = 20) {
  return db.many<{ id: string; event_type: string; headline: string; detected_at: string; entity_id: string | null; document_id: string | null; entity_kind: string | null; slug: string | null }>(
    `select ev.id, ev.event_type, ev.headline, ev.detected_at::text detected_at, ev.entity_id, ev.document_id, e.kind entity_kind, e.attributes->>'slug' slug
       from app.alert_event ev left join entity e on e.id = ev.entity_id where ev.team_id = $1 order by ev.detected_at desc limit $2`, [teamId, limit])
}

export interface Onboarding { client: boolean; watchlist: boolean; bills: boolean; slack: boolean; report: boolean; dismissed: boolean }

export async function onboarding(db: Db, teamId: string, userId: string): Promise<Onboarding> {
  const r = await db.one<Omit<Onboarding, 'dismissed'>>(
    `select exists (select 1 from app.client where team_id = $1) client,
            exists (select 1 from app.watchlist w where w.team_id = $1 and (not w.is_default or exists (select 1 from app.watchlist_item i where i.watchlist_id = w.id))) watchlist,
            exists (select 1 from app.watchlist w join app.watchlist_item i on i.watchlist_id = w.id join entity e on e.id = i.entity_id where w.team_id = $1 and e.kind = 'bill') bills,
            exists (select 1 from app.team where id = $1 and slack_webhook_enc is not null) slack,
            exists (select 1 from app.report where team_id = $1) report`, [teamId])
  const d = await db.one<{ onboarding_dismissed: boolean }>(`select onboarding_dismissed from app.user_pref where user_id = $1`, [userId])
  return { ...r!, dismissed: !!d?.onboarding_dismissed }
}

export function entityHref(kind: string | null, id: string | null, slug: string | null): string | null {
  if (!id) return null
  if (kind === 'bill') return `/bills/${id}`
  if (kind === 'person' && slug) return `/person/${slug}`
  if (kind === 'org' && slug) return `/org/${slug}`
  return null
}
