import type { SupabaseClient } from '@supabase/supabase-js'

export async function getIssueActivity(
  supabase: SupabaseClient,
  topic: string,
  since: string
) {
  // Lobbying registrations mentioning the topic
  const { data: regs } = await supabase
    .from('lobbyist_registration')
    .select('*')
    .contains('issues', [topic])
  // Testimony whose raw_record contains the topic (approximate)
  const { data: testimony } = await supabase
    .from('legislative_testimony')
    .select('*')
    .gte('imported_at', since)
    .limit(500)
  return { topic, registrations: regs ?? [], testimony: testimony ?? [] }
}
