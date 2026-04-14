import type { SupabaseClient } from '@supabase/supabase-js'

export async function listAlerts(
  supabase: SupabaseClient,
  opts: { personId?: string; orgId?: string; limit?: number } = {}
) {
  let q = supabase.from('ax_alert').select('*').order('created_at', { ascending: false }).limit(opts.limit ?? 50)
  if (opts.personId) q = q.eq('person_id', opts.personId)
  if (opts.orgId) q = q.eq('organization_id', opts.orgId)
  const { data, error } = await q
  if (error) throw new Error(`listAlerts: ${error.message}`)
  return data ?? []
}

export async function acknowledgeAlert(supabase: SupabaseClient, alertId: string) {
  const { error } = await supabase.from('ax_alert').update({ acknowledged: true }).eq('id', alertId)
  if (error) throw new Error(`acknowledge: ${error.message}`)
}
