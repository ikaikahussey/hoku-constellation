/**
 * Six dimension score functions, each returning a 0–100 value + evidence.
 * All take a SupabaseClient as the first argument — never construct internally.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DimensionResult } from '../types'
import { TITLE_TIERS } from './score-config'

function cap(x: number): number {
  return Math.max(0, Math.min(100, x))
}

/**
 * Percentile rank of `value` in a sorted ascending array.
 * Returns 0–100. Used to scale raw sums against the population distribution.
 */
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

export async function scorePoliticalMoney(
  supabase: SupabaseClient,
  personId: string
): Promise<DimensionResult> {
  // Sum of donations made by this person (matched only)
  const { data: donations } = await supabase
    .from('contribution')
    .select('amount, recipient_person_id, election_period')
    .eq('donor_person_id', personId)
    .neq('match_status', 'unmatched')

  const given = (donations ?? []).reduce((s, r) => s + Number(r.amount || 0), 0)

  // Build population distribution (could be cached/memoized in prod)
  const { data: pop } = await supabase
    .from('contribution')
    .select('donor_person_id, amount')
    .neq('match_status', 'unmatched')
    .not('donor_person_id', 'is', null)
    .limit(50000)
  const totals = new Map<string, number>()
  for (const row of pop ?? []) {
    const id = String((row as { donor_person_id: string }).donor_person_id)
    totals.set(id, (totals.get(id) ?? 0) + Number((row as { amount: number }).amount || 0))
  }
  const sorted = [...totals.values()].sort((a, b) => a - b)
  let value = percentileRank(sorted, given)

  // +10 if donated to ≥5 distinct recipients in a single election_period
  const byPeriod = new Map<string, Set<string>>()
  for (const d of donations ?? []) {
    const period = (d.election_period ?? 'na') as string
    const rec = (d.recipient_person_id ?? 'none') as string
    if (!byPeriod.has(period)) byPeriod.set(period, new Set())
    byPeriod.get(period)!.add(rec)
  }
  if ([...byPeriod.values()].some(s => s.size >= 5)) value += 10

  // +15 if officer/treasurer of a PAC org
  const { data: pacRoles } = await supabase
    .from('relationship')
    .select('id, relationship_type, target_org_id, organization:target_org_id(org_type)')
    .eq('source_person_id', personId)
    .in('relationship_type', ['officer', 'treasurer'])
  if ((pacRoles ?? []).some(r => (r as { organization?: { org_type?: string } }).organization?.org_type === 'pac')) value += 15

  return { value: cap(value), evidence: { given_sum: given, distinct_periods: byPeriod.size } }
}

export async function scoreInstitutionalPosition(
  supabase: SupabaseClient,
  personId: string
): Promise<DimensionResult> {
  const { data: person } = await supabase
    .from('person')
    .select('entity_types, office_held')
    .eq('id', personId)
    .single()

  const { data: rels } = await supabase
    .from('relationship')
    .select('id, title, relationship_type, target_org_id, is_current')
    .eq('source_person_id', personId)
    .eq('is_current', true)

  let best = 0
  if (person?.office_held) {
    const key = person.office_held.toLowerCase()
    for (const [tier, score] of Object.entries(TITLE_TIERS)) {
      if (key.includes(tier)) best = Math.max(best, score)
    }
  }
  for (const r of rels ?? []) {
    const title = (r.title ?? '').toLowerCase()
    for (const [tier, score] of Object.entries(TITLE_TIERS)) {
      if (title.includes(tier)) best = Math.max(best, score)
    }
  }
  const extra = Math.min(20, Math.max(0, (rels?.length ?? 1) - 1) * 5)
  return { value: cap(best + extra), evidence: { best, extra, role_count: rels?.length ?? 0 } }
}

export async function scoreLobbying(
  supabase: SupabaseClient,
  personId: string
): Promise<DimensionResult> {
  const { data: regs } = await supabase
    .from('lobbyist_registration')
    .select('id')
    .eq('lobbyist_person_id', personId)

  let base = 0
  if ((regs ?? []).length > 0) {
    const { data: exp } = await supabase
      .from('lobbyist_expenditure')
      .select('amount')
      .eq('lobbyist_person_id', personId)
    const total = (exp ?? []).reduce((s, r) => s + Number(r.amount || 0), 0)
    base = cap(Math.log10(Math.max(1, total)) * 15)
  } else {
    const { data: testimony } = await supabase
      .from('legislative_testimony')
      .select('bill_number, session')
      .eq('person_id', personId)
    base = cap(((testimony?.length ?? 0) / 20) * 100)
    const perSession = new Map<string, Set<string>>()
    for (const t of testimony ?? []) {
      const key = (t.session ?? 'na') as string
      if (!perSession.has(key)) perSession.set(key, new Set())
      perSession.get(key)!.add(t.bill_number)
    }
    if ([...perSession.values()].some(s => s.size >= 5)) base += 10
  }
  return { value: cap(base), evidence: { is_registered: (regs?.length ?? 0) > 0 } }
}

export async function scoreEconomicFootprint(
  supabase: SupabaseClient,
  personId: string
): Promise<DimensionResult> {
  const { data: props } = await supabase
    .from('property_ownership')
    .select('assessed_value')
    .eq('owner_person_id', personId)
  const propSum = (props ?? []).reduce((s, r) => s + Number(r.assessed_value || 0), 0)

  // Contracts via orgs where person is officer
  const { data: orgRoles } = await supabase
    .from('relationship')
    .select('target_org_id')
    .eq('source_person_id', personId)
    .in('relationship_type', ['officer', 'director', 'board_member'])
  const orgIds = [...new Set((orgRoles ?? []).map(r => r.target_org_id).filter(Boolean))] as string[]

  let contractSum = 0
  if (orgIds.length > 0) {
    const { data: contracts } = await supabase
      .from('government_contract')
      .select('contract_amount')
      .in('vendor_org_id', orgIds)
    contractSum = (contracts ?? []).reduce((s, r) => s + Number(r.contract_amount || 0), 0)
  }

  const propScore = propSum > 0 ? cap(Math.log10(propSum) * 10) : 0
  const contractScore = contractSum > 0 ? cap(Math.log10(contractSum) * 10) : 0
  const value = cap(propScore * 0.5 + contractScore * 0.5)
  return { value, evidence: { property_sum: propSum, contract_sum: contractSum } }
}

/**
 * Network centrality is precomputed elsewhere; this reader returns the cached
 * value if present in ax_influence_score, else 0.
 */
export async function scoreNetworkCentrality(
  supabase: SupabaseClient,
  personId: string
): Promise<DimensionResult> {
  const { data } = await supabase
    .from('ax_influence_score')
    .select('network_centrality_score')
    .eq('person_id', personId)
    .maybeSingle()
  return { value: Number(data?.network_centrality_score ?? 0), evidence: { cached: true } }
}

export async function scorePublicVisibility(
  supabase: SupabaseClient,
  personId: string
): Promise<DimensionResult> {
  const { count: mentionCount } = await supabase
    .from('article_entity_mention')
    .select('id', { count: 'exact', head: true })
    .eq('person_id', personId)

  const twoYearsAgo = new Date()
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)
  const { count: testimonyCount } = await supabase
    .from('legislative_testimony')
    .select('id', { count: 'exact', head: true })
    .eq('person_id', personId)
    .gte('hearing_date', twoYearsAgo.toISOString().slice(0, 10))

  const news = cap(((mentionCount ?? 0) / 50) * 100)
  const testimony = cap(((testimonyCount ?? 0) / 20) * 100)
  return { value: cap(news * 0.6 + testimony * 0.4), evidence: { mentions: mentionCount, testimonies: testimonyCount } }
}
