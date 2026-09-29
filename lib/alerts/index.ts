/**
 * Alert pipeline entry points (E2). Called after each ingestion batch commits and by the alerts
 * worker tick (workers/alerts.ts, /api/cron/alerts).
 */
import type { Db } from '@/lib/db/types'
import { runMatcher, type MatchResult } from './matcher'
import { runDelivery, runDigests, type DeliveryResult, type DigestResult } from './delivery'
import { defaultChannels, type Channels } from './channels'

export { runMatcher } from './matcher'
export { runDelivery, runDigests } from './delivery'
export { ALERT_EVENT_TYPES, EVENT_LABELS } from './events'

export interface PipelineResult { match: MatchResult; delivery: DeliveryResult; digests?: DigestResult }

export async function runAlertPipeline(db: Db, opts: { now?: Date; channels?: Channels; digests?: boolean } = {}): Promise<PipelineResult> {
  const channels = opts.channels ?? defaultChannels()
  const match = await runMatcher(db, { now: opts.now })
  const delivery = await runDelivery(db, channels, { now: opts.now })
  const digests = opts.digests ? await runDigests(db, channels, { now: opts.now }) : undefined
  return { match, delivery, digests }
}

export interface AlertStats {
  byDay: Array<{ day: string; events: number; delivered: number; failed: number }>
  latency: { n: number; p50: number | null; p95: number | null; max: number | null; histogram: Array<{ bucket: string; n: number }> }
  failures: Array<{ id: string; channel: string; error: string | null; attempts: number; created_at: string; team_name: string }>
  pending: number
}

/** Admin view: volume, commit → sent latency distribution (instant channels), and recent failures. */
export async function alertStats(db: Db, days = 14): Promise<AlertStats> {
  const byDay = await db.many<{ day: string; events: number; delivered: number; failed: number }>(
    `select to_char(date_trunc('day', ev.detected_at at time zone 'Pacific/Honolulu'), 'YYYY-MM-DD') day,
            count(distinct ev.id)::int events,
            count(d.id) filter (where d.status in ('sent','collapsed','digested'))::int delivered,
            count(d.id) filter (where d.status = 'failed')::int failed
       from app.alert_event ev left join app.alert_delivery d on d.alert_event_id = ev.id
      where ev.detected_at > now() - make_interval(days => $1)
      group by 1 order by 1 desc`, [days])
  const lat = await db.many<{ s: number }>(
    `select extract(epoch from (d.sent_at - coalesce(ev.fetched_at, ev.detected_at)))::float8 s
       from app.alert_delivery d join app.alert_event ev on ev.id = d.alert_event_id
      where d.status = 'sent' and d.channel in ('email','slack') and d.sent_at > now() - make_interval(days => $1)
        and ev.event_type <> 'bill.testimony_deadline'`, [days])
  const values = lat.map(l => Math.max(0, Number(l.s))).sort((a, b) => a - b)
  const q = (p: number) => values.length ? values[Math.min(values.length - 1, Math.ceil(p * values.length) - 1)] : null
  const buckets: Array<[string, number]> = [['<10s', 10], ['10–30s', 30], ['30–60s', 60], ['1–5m', 300], ['5–15m', 900], ['>15m', Infinity]]
  const histogram = buckets.map(([bucket, hi], i) => ({ bucket, n: values.filter(v => v < hi && v >= (i ? buckets[i - 1][1] : 0)).length }))
  const failures = await db.many<AlertStats['failures'][number]>(
    `select d.id, d.channel, d.error, d.attempts, d.created_at::text created_at, t.name team_name
       from app.alert_delivery d join app.team t on t.id = d.team_id where d.status = 'failed' order by d.created_at desc limit 50`)
  const pending = (await db.one<{ n: number }>(`select count(*)::int n from app.alert_delivery where status in ('pending','deferred')`))!.n
  return { byDay, latency: { n: values.length, p50: q(0.5), p95: q(0.95), max: values.at(-1) ?? null, histogram }, failures, pending }
}
