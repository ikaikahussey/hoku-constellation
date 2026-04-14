import type { SupabaseClient } from '@supabase/supabase-js'

export async function compareEntities(supabase: SupabaseClient, personIds: string[]) {
  const { data: scores } = await supabase
    .from('ax_influence_score')
    .select('*')
    .in('person_id', personIds)
  const { data: people } = await supabase
    .from('person')
    .select('id, full_name, office_held')
    .in('id', personIds)
  return {
    people: people ?? [],
    scores: scores ?? [],
  }
}
