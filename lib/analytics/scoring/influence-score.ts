import type { SupabaseClient } from '@supabase/supabase-js'
import { SCORE_WEIGHTS, SCORE_VERSION } from './score-config'
import {
  scorePoliticalMoney,
  scoreInstitutionalPosition,
  scoreLobbying,
  scoreEconomicFootprint,
  scoreNetworkCentrality,
  scorePublicVisibility,
} from './dimension-scores'
import type { ScoreBreakdown } from '../types'

export async function computeInfluenceScore(
  supabase: SupabaseClient,
  personId: string
): Promise<ScoreBreakdown> {
  const [pm, ip, lb, ef, nc, pv] = await Promise.all([
    scorePoliticalMoney(supabase, personId),
    scoreInstitutionalPosition(supabase, personId),
    scoreLobbying(supabase, personId),
    scoreEconomicFootprint(supabase, personId),
    scoreNetworkCentrality(supabase, personId),
    scorePublicVisibility(supabase, personId),
  ])

  const composite = Math.min(
    100,
    pm.value * SCORE_WEIGHTS.political_money +
      ip.value * SCORE_WEIGHTS.institutional_position +
      lb.value * SCORE_WEIGHTS.lobbying +
      ef.value * SCORE_WEIGHTS.economic_footprint +
      nc.value * SCORE_WEIGHTS.network_centrality +
      pv.value * SCORE_WEIGHTS.public_visibility
  )

  const breakdown: ScoreBreakdown = {
    composite: Math.round(composite * 10) / 10,
    political_money: pm.value,
    institutional_position: ip.value,
    lobbying: lb.value,
    economic_footprint: ef.value,
    network_centrality: nc.value,
    public_visibility: pv.value,
  }

  const { error } = await supabase.from('ax_influence_score').upsert({
    person_id: personId,
    composite_score: breakdown.composite,
    political_money_score: breakdown.political_money,
    institutional_position_score: breakdown.institutional_position,
    lobbying_score: breakdown.lobbying,
    economic_footprint_score: breakdown.economic_footprint,
    network_centrality_score: breakdown.network_centrality,
    public_visibility_score: breakdown.public_visibility,
    computed_at: new Date().toISOString(),
    score_version: SCORE_VERSION,
  })
  if (error) throw new Error(`ax_influence_score upsert: ${error.message}`)
  return breakdown
}

/**
 * Recompute scores for all persons with ANY canonical activity.
 * Returns count of persons scored.
 */
export async function recomputeAllScores(supabase: SupabaseClient): Promise<number> {
  const { data: people } = await supabase.from('person').select('id').eq('status', 'active')
  let count = 0
  for (const p of people ?? []) {
    try {
      await computeInfluenceScore(supabase, p.id)
      count++
    } catch (e) {
      console.error(`score ${p.id}: ${(e as Error).message}`)
    }
  }
  // Assign ranks
  const { data: scored } = await supabase
    .from('ax_influence_score')
    .select('person_id, composite_score')
    .order('composite_score', { ascending: false })
  let rank = 1
  for (const row of scored ?? []) {
    const percentile = scored && scored.length > 0
      ? Math.round(((scored.length - rank + 1) / scored.length) * 10000) / 100
      : 0
    await supabase
      .from('ax_influence_score')
      .update({ rank, percentile })
      .eq('person_id', row.person_id)
    rank++
  }
  return count
}
