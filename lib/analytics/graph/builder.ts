/**
 * Graph builder — derives ax_relationship_edge from canonical tables.
 * Truncate-and-rebuild for idempotency. Separate from canonical `relationship`.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EdgeType } from '../types'

interface DerivedEdge {
  source_person_id: string
  target_person_id: string
  relationship_type: EdgeType
  weight: number
  evidence: Record<string, unknown>
}

function edgeKey(a: string, b: string, type: EdgeType) {
  return a < b ? `${a}|${b}|${type}` : `${b}|${a}|${type}`
}

export async function rebuildRelationshipEdges(
  supabase: SupabaseClient
): Promise<{ edges: number }> {
  const acc = new Map<string, DerivedEdge>()

  function add(a: string, b: string, type: EdgeType, weight = 1, ev: Record<string, unknown> = {}) {
    if (!a || !b || a === b) return
    const [s, t] = a < b ? [a, b] : [b, a]
    const key = edgeKey(s, t, type)
    const existing = acc.get(key)
    if (existing) {
      existing.weight += weight
    } else {
      acc.set(key, { source_person_id: s, target_person_id: t, relationship_type: type, weight, evidence: ev })
    }
  }

  // ---- co_donor & donor_candidate ----
  const { data: contribs } = await supabase
    .from('contribution')
    .select('donor_person_id, recipient_person_id, election_period, amount')
    .neq('match_status', 'unmatched')
    .not('donor_person_id', 'is', null)
    .limit(100000)
  const byRecipientPeriod = new Map<string, Set<string>>()
  for (const c of contribs ?? []) {
    if (c.donor_person_id && c.recipient_person_id) {
      add(c.donor_person_id, c.recipient_person_id, 'donor_candidate', 1, { period: c.election_period })
      const key = `${c.recipient_person_id}|${c.election_period ?? ''}`
      if (!byRecipientPeriod.has(key)) byRecipientPeriod.set(key, new Set())
      byRecipientPeriod.get(key)!.add(c.donor_person_id)
    }
  }
  for (const donors of byRecipientPeriod.values()) {
    const list = [...donors]
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        add(list[i], list[j], 'co_donor', 0.5)
      }
    }
  }

  // ---- co_board_member / shared_organization ----
  const { data: rels } = await supabase
    .from('relationship')
    .select('source_person_id, target_org_id, relationship_type, is_current')
    .not('source_person_id', 'is', null)
    .not('target_org_id', 'is', null)
  const byOrg = new Map<string, Set<string>>()
  for (const r of rels ?? []) {
    if (!byOrg.has(r.target_org_id!)) byOrg.set(r.target_org_id!, new Set())
    byOrg.get(r.target_org_id!)!.add(r.source_person_id!)
  }
  for (const [, members] of byOrg) {
    const list = [...members]
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        add(list[i], list[j], 'shared_organization', 1)
      }
    }
  }

  // ---- co_testimony & opposing_testimony ----
  const { data: testimonies } = await supabase
    .from('legislative_testimony')
    .select('person_id, bill_number, position')
    .not('person_id', 'is', null)
  const byBill = new Map<string, Array<{ person: string; position: string }>>()
  for (const t of testimonies ?? []) {
    if (!byBill.has(t.bill_number)) byBill.set(t.bill_number, [])
    byBill.get(t.bill_number)!.push({ person: t.person_id!, position: t.position })
  }
  for (const entries of byBill.values()) {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i], b = entries[j]
        if (a.position === b.position) add(a.person, b.person, 'co_testimony', 1)
        else add(a.person, b.person, 'opposing_testimony', 0.5)
      }
    }
  }

  // ---- lobbyist_client_officer ----
  const { data: lobbyRegs } = await supabase
    .from('lobbyist_registration')
    .select('lobbyist_person_id, client_org_id')
    .not('lobbyist_person_id', 'is', null)
    .not('client_org_id', 'is', null)
  for (const lr of lobbyRegs ?? []) {
    const officers = byOrg.get(lr.client_org_id!) ?? new Set()
    for (const o of officers) {
      add(lr.lobbyist_person_id!, o, 'lobbyist_client_officer', 1)
    }
  }

  // Write: truncate then insert in batches
  await supabase.from('ax_relationship_edge').delete().neq('source_person_id', '00000000-0000-0000-0000-000000000000')
  const rows = [...acc.values()].map(e => ({
    source_person_id: e.source_person_id,
    target_person_id: e.target_person_id,
    relationship_type: e.relationship_type,
    weight: Math.round(e.weight * 1000) / 1000,
    evidence: e.evidence,
  }))
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500)
    const { error } = await supabase.from('ax_relationship_edge').insert(batch)
    if (error) console.error(`edge insert batch ${i}: ${error.message}`)
  }

  return { edges: rows.length }
}
