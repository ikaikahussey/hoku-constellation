import type { Db } from '@/lib/db/types'
import { SCORE_WEIGHTS, SCORE_VERSION } from './score-config'
import {
  scorePoliticalMoney, scoreInstitutionalPosition, scoreLobbying,
  scoreEconomicFootprint, scoreNetworkCentrality, scorePublicVisibility,
} from './dimension-scores'
import type { ScoreBreakdown } from '../types'

/** Score one person entity and upsert ax_influence_score. */
export async function computeInfluenceScore(db: Db, entityId: string): Promise<ScoreBreakdown> {
  const [pm, ip, lb, ef, nc, pv] = await Promise.all([
    scorePoliticalMoney(db, entityId),
    scoreInstitutionalPosition(db, entityId),
    scoreLobbying(db, entityId),
    scoreEconomicFootprint(db, entityId),
    scoreNetworkCentrality(db, entityId),
    scorePublicVisibility(db, entityId),
  ])
  const composite = Math.min(100,
    pm.value * SCORE_WEIGHTS.political_money + ip.value * SCORE_WEIGHTS.institutional_position + lb.value * SCORE_WEIGHTS.lobbying +
    ef.value * SCORE_WEIGHTS.economic_footprint + nc.value * SCORE_WEIGHTS.network_centrality + pv.value * SCORE_WEIGHTS.public_visibility)
  const breakdown: ScoreBreakdown = {
    composite: Math.round(composite * 10) / 10,
    political_money: pm.value, institutional_position: ip.value, lobbying: lb.value,
    economic_footprint: ef.value, network_centrality: nc.value, public_visibility: pv.value,
  }
  await db.query(
    `insert into ax_influence_score(entity_id, composite_score, political_money_score, institutional_position_score, lobbying_score,
                                    economic_footprint_score, network_centrality_score, public_visibility_score, computed_at, score_version)
     values ($1,$2,$3,$4,$5,$6,$7,$8, now(), $9)
     on conflict (entity_id) do update set composite_score = excluded.composite_score, political_money_score = excluded.political_money_score,
       institutional_position_score = excluded.institutional_position_score, lobbying_score = excluded.lobbying_score,
       economic_footprint_score = excluded.economic_footprint_score, network_centrality_score = excluded.network_centrality_score,
       public_visibility_score = excluded.public_visibility_score, computed_at = now(), score_version = excluded.score_version`,
    [entityId, breakdown.composite, pm.value, ip.value, lb.value, ef.value, nc.value, pv.value, SCORE_VERSION])
  return breakdown
}

/** Per-person recompute (slow path; prefer recomputeAllScoresBatch). Returns count scored. */
export async function recomputeAllScores(db: Db): Promise<number> {
  const people = await db.many<{ id: string }>(`select id from entity where kind = 'person' and merged_into_id is null and coalesce(attributes ->> 'status', 'active') = 'active'`)
  let count = 0
  for (const p of people) {
    try { await computeInfluenceScore(db, p.id); count++ } catch (e) { console.error(`score ${p.id}: ${(e as Error).message}`) }
  }
  await db.query(
    `with ranked as (select entity_id, row_number() over (order by composite_score desc) rk, count(*) over () total from ax_influence_score)
     update ax_influence_score s set rank = r.rk, percentile = round(((r.total - r.rk + 1)::numeric / r.total) * 100, 2) from ranked r where r.entity_id = s.entity_id`)
  return count
}
