/**
 * Six dimension score functions for a single person entity, each returning a 0–100 value + evidence.
 * All take a `Db` as the first argument — never construct one internally. Reads only edge/entity.
 */
import type { Db } from '@/lib/db/types'
import type { DimensionResult } from '../types'
import { TITLE_TIERS } from './score-config'

function cap(x: number): number { return Math.max(0, Math.min(100, x)) }

function percentileRank(sorted: number[], value: number): number {
  if (sorted.length === 0) return 0
  let lo = 0, hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sorted[mid] < value) lo = mid + 1
    else hi = mid
  }
  return (lo / sorted.length) * 100
}

export async function scorePoliticalMoney(db: Db, entityId: string): Promise<DimensionResult> {
  const donations = await db.many<{ amount: string | null; to_id: string | null; election_period: string | null }>(
    `select amount::text, to_id, attributes ->> 'election_period' election_period from edge
      where type = 'contributed_to' and from_id = $1 and match_status <> 'unmatched'`, [entityId])
  const given = donations.reduce((s, r) => s + Number(r.amount || 0), 0)

  const pop = await db.many<{ total: string }>(
    `select sum(amount)::text total from edge where type = 'contributed_to' and from_id is not null and match_status <> 'unmatched' group by from_id`)
  const sorted = pop.map(p => Number(p.total)).sort((a, b) => a - b)
  let value = percentileRank(sorted, given)

  const byPeriod = new Map<string, Set<string>>()
  for (const d of donations) {
    const period = d.election_period ?? 'na'
    if (!byPeriod.has(period)) byPeriod.set(period, new Set())
    byPeriod.get(period)!.add(d.to_id ?? 'none')
  }
  if ([...byPeriod.values()].some(s => s.size >= 5)) value += 10

  const pac = await db.one<{ n: string }>(
    `select count(*)::text n from edge e join entity o on o.id = e.to_id
      where e.type = 'officer_of' and e.from_id = $1 and o.attributes ->> 'org_type' = 'pac'`, [entityId])
  if (Number(pac?.n ?? 0) > 0) value += 15

  return { value: cap(value), evidence: { given_sum: given, distinct_periods: byPeriod.size } }
}

export async function scoreInstitutionalPosition(db: Db, entityId: string): Promise<DimensionResult> {
  const person = await db.one<{ office_held: string | null }>(`select attributes ->> 'office_held' office_held from entity where id = $1`, [entityId])
  const rels = await db.many<{ role: string | null }>(
    `select role from edge where from_id = $1 and type in ('employed_by','officer_of','director_of','member_of','appointed_to')
       and end_date is null and coalesce((attributes ->> 'is_current')::boolean, true)`, [entityId])
  let best = 0
  const office = (person?.office_held ?? '').toLowerCase()
  for (const [tier, score] of Object.entries(TITLE_TIERS)) if (office.includes(tier)) best = Math.max(best, score)
  for (const r of rels) {
    const title = (r.role ?? '').toLowerCase()
    for (const [tier, score] of Object.entries(TITLE_TIERS)) if (title.includes(tier)) best = Math.max(best, score)
  }
  const extra = Math.min(20, Math.max(0, rels.length - 1) * 5)
  return { value: cap(best + extra), evidence: { best, extra, role_count: rels.length } }
}

export async function scoreLobbying(db: Db, entityId: string): Promise<DimensionResult> {
  const regs = await db.one<{ n: string }>(`select count(*)::text n from edge where type = 'lobbied_for' and from_id = $1`, [entityId])
  const isRegistered = Number(regs?.n ?? 0) > 0
  let base = 0
  if (isRegistered) {
    const exp = await db.one<{ total: string | null }>(`select sum(amount)::text total from edge where type = 'spent_with' and from_id = $1`, [entityId])
    base = cap(Math.log10(Math.max(1, Number(exp?.total ?? 0))) * 15)
  } else {
    const t = await db.many<{ to_id: string | null; session: string | null }>(
      `select to_id, attributes ->> 'session' session from edge where type = 'testified_on' and from_id = $1`, [entityId])
    base = cap((t.length / 20) * 100)
    const perSession = new Map<string, Set<string>>()
    for (const row of t) {
      const key = row.session ?? 'na'
      if (!perSession.has(key)) perSession.set(key, new Set())
      if (row.to_id) perSession.get(key)!.add(row.to_id)
    }
    if ([...perSession.values()].some(s => s.size >= 5)) base += 10
  }
  return { value: cap(base), evidence: { is_registered: isRegistered } }
}

export async function scoreEconomicFootprint(db: Db, entityId: string): Promise<DimensionResult> {
  const prop = await db.one<{ total: string | null }>(
    `select sum((attributes ->> 'assessed_value')::numeric)::text total from edge where type = 'owns' and from_id = $1`, [entityId])
  const propSum = Number(prop?.total ?? 0)
  const contracts = await db.one<{ total: string | null }>(
    `select sum(c.amount)::text total from edge r join edge c on c.to_id = r.to_id and c.type in ('awarded_contract','awarded_grant')
      where r.from_id = $1 and r.type in ('officer_of','director_of')`, [entityId])
  const contractSum = Number(contracts?.total ?? 0)
  const propScore = propSum > 0 ? cap(Math.log10(propSum) * 10) : 0
  const contractScore = contractSum > 0 ? cap(Math.log10(contractSum) * 10) : 0
  return { value: cap(propScore * 0.5 + contractScore * 0.5), evidence: { property_sum: propSum, contract_sum: contractSum } }
}

/** Network centrality is precomputed by rebuild-graph; return the cached value if present. */
export async function scoreNetworkCentrality(db: Db, entityId: string): Promise<DimensionResult> {
  const row = await db.one<{ v: string | null }>(`select network_centrality_score::text v from ax_influence_score where entity_id = $1`, [entityId])
  return { value: Number(row?.v ?? 0), evidence: { cached: true } }
}

export async function scorePublicVisibility(db: Db, entityId: string): Promise<DimensionResult> {
  const twoYearsAgo = new Date(); twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)
  const row = await db.one<{ mentions: string; testimonies: string }>(
    `select (select count(*) from edge e join document d on d.id = e.document_id where e.type = 'mentioned_in' and e.from_id = $1 and d.doc_type = 'article')::text mentions,
            (select count(*) from edge where type = 'testified_on' and from_id = $1 and start_date >= $2)::text testimonies`,
    [entityId, twoYearsAgo.toISOString().slice(0, 10)])
  const mentions = Number(row?.mentions ?? 0), testimonies = Number(row?.testimonies ?? 0)
  const news = cap((mentions / 50) * 100)
  const t = cap((testimonies / 20) * 100)
  return { value: cap(news * 0.6 + t * 0.4), evidence: { mentions, testimonies } }
}
