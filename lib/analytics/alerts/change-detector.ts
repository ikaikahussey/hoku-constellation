import type { SupabaseClient } from '@supabase/supabase-js'
import type { AlertRecord } from '../types'
import { ALERT_RULES } from './alert-rules'

function sourceKey(records: AlertRecord['source_records'] | undefined): string {
  if (!records || records.length === 0) return ''
  const first = records[0]
  return `${first.table}:${first.id}`
}

/**
 * Runs all alert rules for records since `since`, deduplicates, and inserts new ones.
 *
 * Dedup layers:
 *   1. Exact source-record match against ALL existing alerts — prevents the same
 *      canonical row from ever firing twice (e.g. re-running on historical data).
 *   2. 24h window match on (person_id, alert_type) — prevents rapid-fire noise
 *      for the same subject across different source rows.
 */
export async function detectChanges(
  supabase: SupabaseClient,
  since: string
): Promise<{ inserted: number }> {
  const allAlerts: AlertRecord[] = []
  for (const rule of ALERT_RULES) {
    try {
      const rows = await rule(supabase, since)
      allAlerts.push(...rows)
    } catch (e) {
      console.error(`alert rule: ${(e as Error).message}`)
    }
  }

  // Layer 1: all-time dedup by source_records[0] table+id
  const candidateSourceKeys = new Set(
    allAlerts.map(a => sourceKey(a.source_records)).filter(k => k.length > 0)
  )
  const existingSourceKeys = new Set<string>()
  if (candidateSourceKeys.size > 0) {
    // Fetch existing alerts touching any of the candidate source rows
    const { data: existing } = await supabase
      .from('ax_alert')
      .select('source_records')
      .not('source_records', 'is', null)
      .limit(50000)
    for (const row of existing ?? []) {
      const recs = (row as { source_records?: AlertRecord['source_records'] }).source_records
      const key = sourceKey(recs)
      if (key) existingSourceKeys.add(key)
    }
  }

  // Layer 2: 24-hour dedup on (person, alert_type)
  const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const { data: recent } = await supabase
    .from('ax_alert')
    .select('person_id, alert_type')
    .gte('created_at', oneDayAgo)
  const recentKeys = new Set((recent ?? []).map(r => `${r.person_id ?? 'x'}|${r.alert_type}`))

  const toInsert = allAlerts.filter(a => {
    const sk = sourceKey(a.source_records)
    if (sk && existingSourceKeys.has(sk)) return false
    if (recentKeys.has(`${a.person_id ?? 'x'}|${a.alert_type}`)) return false
    return true
  })
  if (toInsert.length === 0) return { inserted: 0 }

  const { error } = await supabase.from('ax_alert').insert(
    toInsert.map(a => ({
      alert_type: a.alert_type,
      severity: a.severity,
      person_id: a.person_id ?? null,
      organization_id: a.organization_id ?? null,
      headline: a.headline,
      detail: a.detail,
      source_records: a.source_records,
    }))
  )
  if (error) throw new Error(`ax_alert insert: ${error.message}`)
  return { inserted: toInsert.length }
}
