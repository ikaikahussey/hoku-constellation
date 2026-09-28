/**
 * Graph builder — derives ax_relationship_edge (person ↔ person analytical edges) from canonical edges.
 * Truncate-and-rebuild for idempotency. Never conflated with canonical `edge` rows.
 */
import type { Db } from '@/lib/db/types'
import type { DerivedEdgeType } from '../types'

interface DerivedEdge {
  source_entity_id: string
  target_entity_id: string
  relationship_type: DerivedEdgeType
  weight: number
  evidence: Record<string, unknown>
}

export async function deriveEdges(db: Db): Promise<DerivedEdge[]> {
  const acc = new Map<string, DerivedEdge>()
  function add(a: string, b: string, type: DerivedEdgeType, weight = 1, ev: Record<string, unknown> = {}) {
    if (!a || !b || a === b) return
    const [s, t] = a < b ? [a, b] : [b, a]
    const key = `${s}|${t}|${type}`
    const existing = acc.get(key)
    if (existing) existing.weight += weight
    else acc.set(key, { source_entity_id: s, target_entity_id: t, relationship_type: type, weight, evidence: ev })
  }

  const persons = new Set((await db.many<{ id: string }>(`select id from entity where kind = 'person' and merged_into_id is null`)).map(p => p.id))
  const isPerson = (id: string | null): id is string => !!id && persons.has(id)

  // ---- co_donor & donor_candidate ----
  const contribs = await db.many<{ from_id: string | null; to_id: string | null; election_period: string | null }>(
    `select from_id, to_id, attributes ->> 'election_period' election_period from edge
      where type = 'contributed_to' and match_status <> 'unmatched' and from_id is not null and to_id is not null limit 500000`)
  const byRecipientPeriod = new Map<string, Set<string>>()
  for (const c of contribs) {
    if (isPerson(c.from_id) && isPerson(c.to_id)) add(c.from_id, c.to_id, 'donor_candidate', 1, { period: c.election_period })
    if (isPerson(c.from_id) && c.to_id) {
      const key = `${c.to_id}|${c.election_period ?? ''}`
      if (!byRecipientPeriod.has(key)) byRecipientPeriod.set(key, new Set())
      byRecipientPeriod.get(key)!.add(c.from_id)
    }
  }
  for (const donors of byRecipientPeriod.values()) {
    const list = [...donors]
    if (list.length > 200) continue // cap dense hubs (large committees) to keep the graph tractable
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) add(list[i], list[j], 'co_donor', 0.5)
  }

  // ---- co_board_member / shared_organization ----
  const rels = await db.many<{ from_id: string | null; to_id: string | null; type: string }>(
    `select from_id, to_id, type from edge where type in ('employed_by','officer_of','director_of','member_of','appointed_to') and from_id is not null and to_id is not null`)
  const byOrg = new Map<string, Set<string>>()
  const boardByOrg = new Map<string, Set<string>>()
  for (const r of rels) {
    if (!isPerson(r.from_id) || !r.to_id) continue
    if (!byOrg.has(r.to_id)) byOrg.set(r.to_id, new Set())
    byOrg.get(r.to_id)!.add(r.from_id)
    if (r.type === 'director_of' || r.type === 'appointed_to') {
      if (!boardByOrg.has(r.to_id)) boardByOrg.set(r.to_id, new Set())
      boardByOrg.get(r.to_id)!.add(r.from_id)
    }
  }
  for (const [, members] of byOrg) {
    const list = [...members]
    if (list.length > 200) continue
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) add(list[i], list[j], 'shared_organization', 1)
  }
  for (const [, members] of boardByOrg) {
    const list = [...members]
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) add(list[i], list[j], 'co_board_member', 1)
  }

  // ---- co_testimony & opposing_testimony ----
  const testimonies = await db.many<{ from_id: string | null; to_id: string | null; role: string | null }>(
    `select from_id, to_id, role from edge where type = 'testified_on' and from_id is not null and to_id is not null`)
  const byBill = new Map<string, Array<{ person: string; position: string }>>()
  for (const t of testimonies) {
    if (!isPerson(t.from_id) || !t.to_id) continue
    if (!byBill.has(t.to_id)) byBill.set(t.to_id, [])
    byBill.get(t.to_id)!.push({ person: t.from_id, position: (t.role ?? '').toLowerCase() })
  }
  for (const entries of byBill.values()) {
    if (entries.length > 200) continue
    for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j]
      if (a.position === b.position) add(a.person, b.person, 'co_testimony', 1)
      else add(a.person, b.person, 'opposing_testimony', 0.5)
    }
  }

  // ---- lobbyist_client_officer ----
  const lobbyRegs = await db.many<{ from_id: string | null; to_id: string | null }>(
    `select from_id, to_id from edge where type = 'lobbied_for' and from_id is not null and to_id is not null`)
  for (const lr of lobbyRegs) {
    if (!isPerson(lr.from_id) || !lr.to_id) continue
    for (const o of byOrg.get(lr.to_id) ?? []) add(lr.from_id, o, 'lobbyist_client_officer', 1)
  }

  // ---- contractor_agency: officers of vendor orgs ↔ officers of awarding agencies ----
  const contracts = await db.many<{ from_id: string | null; to_id: string | null }>(
    `select from_id, to_id from edge where type in ('awarded_contract','awarded_grant') and from_id is not null and to_id is not null`)
  for (const c of contracts) {
    const agencyPeople = byOrg.get(c.from_id!) ?? new Set()
    const vendorPeople = byOrg.get(c.to_id!) ?? new Set()
    for (const a of agencyPeople) for (const v of vendorPeople) add(a, v, 'contractor_agency', 1)
  }

  return [...acc.values()]
}

export async function rebuildRelationshipEdges(db: Db): Promise<{ edges: number }> {
  const rows = await deriveEdges(db)
  await db.transaction(async tx => {
    await tx.query('delete from ax_relationship_edge')
    for (let i = 0; i < rows.length; i += 1000) {
      const batch = rows.slice(i, i + 1000)
      await tx.query(
        `insert into ax_relationship_edge(source_entity_id, target_entity_id, relationship_type, weight, evidence)
         select * from unnest($1::uuid[], $2::uuid[], $3::text[], $4::numeric[], $5::jsonb[])`,
        [batch.map(e => e.source_entity_id), batch.map(e => e.target_entity_id), batch.map(e => e.relationship_type),
          batch.map(e => Math.round(e.weight * 1000) / 1000), batch.map(e => JSON.stringify(e.evidence))])
    }
  })
  return { edges: rows.length }
}
