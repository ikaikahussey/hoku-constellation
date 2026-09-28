import type { Db } from '@/lib/db/types'
import type { AlertRecord } from '../types'
import { ALERT_RULES } from './alert-rules'

function sourceKey(records: AlertRecord['source_records'] | undefined): string {
  if (!records || records.length === 0) return ''
  const first = records[0]
  return `${first.table}:${first.id}`
}

/**
 * Runs all alert rules for records ingested since `since`, dedups, inserts new ax_alert rows.
 *   1. all-time dedup on source_records[0] (table:id)
 *   2. 24h dedup on (entity_id, alert_type)
 */
export async function detectChanges(db: Db, since: string): Promise<{ inserted: number }> {
  const all: AlertRecord[] = []
  for (const rule of ALERT_RULES) {
    try { all.push(...(await rule(db, since))) } catch (e) { console.error(`alert rule: ${(e as Error).message}`) }
  }
  if (!all.length) return { inserted: 0 }

  const existing = await db.many<{ source_records: AlertRecord['source_records'] }>(`select source_records from ax_alert where jsonb_array_length(source_records) > 0`)
  const existingKeys = new Set(existing.map(r => sourceKey(r.source_records)).filter(Boolean))

  const recent = await db.many<{ entity_id: string | null; alert_type: string }>(
    `select entity_id, alert_type from ax_alert where created_at >= now() - interval '24 hours'`)
  const recentKeys = new Set(recent.map(r => `${r.entity_id ?? 'x'}|${r.alert_type}`))

  const toInsert = all.filter(a => {
    const sk = sourceKey(a.source_records)
    if (sk && existingKeys.has(sk)) return false
    const rk = `${a.entity_id ?? 'x'}|${a.alert_type}`
    if (recentKeys.has(rk)) return false
    recentKeys.add(rk)
    return true
  })
  if (!toInsert.length) return { inserted: 0 }

  await db.query(
    `insert into ax_alert(alert_type, severity, entity_id, headline, detail, source_records)
     select * from unnest($1::text[], $2::text[], $3::uuid[], $4::text[], $5::jsonb[], $6::jsonb[])`,
    [toInsert.map(a => a.alert_type), toInsert.map(a => a.severity), toInsert.map(a => a.entity_id ?? null), toInsert.map(a => a.headline),
      toInsert.map(a => JSON.stringify(a.detail)), toInsert.map(a => JSON.stringify(a.source_records))])
  return { inserted: toInsert.length }
}
