/**
 * Alert-rule management used by the account UI and one-click links. User-facing writes go through
 * these helpers with the service Db after the route has checked team membership.
 */
import type { Db } from '@/lib/db/types'
import { ALERT_EVENT_TYPES } from './events'

export type AlertChannel = 'email' | 'slack' | 'digest_daily' | 'digest_weekly'
export const USER_CHANNELS: AlertChannel[] = ['email', 'slack', 'digest_daily', 'digest_weekly']

export interface NewRule {
  watchlistId: string
  userId: string | null
  channel: AlertChannel
  eventTypes?: string[]
  quietStart?: string | null
  quietEnd?: string | null
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export async function createAlertRule(db: Db, r: NewRule): Promise<{ id: string }> {
  const types = (r.eventTypes ?? []).filter(t => (ALERT_EVENT_TYPES as readonly string[]).includes(t))
  if ((r.quietStart && !TIME.test(r.quietStart)) || (r.quietEnd && !TIME.test(r.quietEnd))) throw new Error('Quiet hours must be HH:MM')
  if (!USER_CHANNELS.includes(r.channel)) throw new Error('Unsupported channel')
  const team = await db.one<{ alerts: boolean }>(`select (app.team_features(app.watchlist_team($1))).alerts`, [r.watchlistId])
  if (!team?.alerts) throw new Error('Alerts are not included in this plan')
  return (await db.one<{ id: string }>(
    `insert into app.alert_rule(watchlist_id, user_id, channel, event_types, quiet_start, quiet_end) values ($1, $2, $3, $4, $5, $6) returning id`,
    [r.watchlistId, r.channel === 'slack' ? null : r.userId, r.channel, types, r.quietStart || null, r.quietEnd || null]))!
}

/** One-click unsubscribe (List-Unsubscribe-Post). Idempotent. */
export async function unsubscribeRule(db: Db, ruleId: string): Promise<boolean> {
  const r = await db.query(`update app.alert_rule set unsubscribed_at = coalesce(unsubscribed_at, now()) where id = $1`, [ruleId])
  return r.rowCount > 0
}

export async function muteRule(db: Db, ruleId: string, until: Date | null): Promise<void> {
  await db.query(`update app.alert_rule set muted_until = $2 where id = $1`, [ruleId, until?.toISOString() ?? null])
}

export async function markDeliveryOpened(db: Db, deliveryId: string): Promise<void> {
  await db.query(`update app.alert_delivery set opened_at = coalesce(opened_at, now()) where id = $1`, [deliveryId])
}
