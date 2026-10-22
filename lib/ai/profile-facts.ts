/**
 * Convert profile edges into Fact objects for generateCitedNarrative.
 *
 * Each EdgeView becomes one plain-English fact sentence tied to its document_id.
 * The sentence must be understandable on its own — the model never sees the raw edge.
 */
import type { Db, EntityRow } from '@/lib/db/types'
import type { EdgeView, PersonProfile, OrgProfile } from '@/lib/analytics/types'
import type { Fact } from './citations'
import { getPersonProfile } from '@/lib/analytics/profiles/person-profile'
import { getOrgProfile } from '@/lib/analytics/profiles/org-profile'

// ---------------------------------------------------------------- edge → fact

function amount(edge: EdgeView): string {
  if (edge.amount == null) return ''
  const n = typeof edge.amount === 'string' ? Number(edge.amount) : edge.amount
  if (isNaN(n)) return ''
  return ` ($${n.toLocaleString('en-US')})`
}

function dateStr(edge: EdgeView): string | null {
  return edge.start_date ?? edge.doc_date ?? null
}

function dateSuffix(edge: EdgeView): string {
  const d = dateStr(edge)
  return d ? ` (${d})` : ''
}

function from(edge: EdgeView): string {
  return edge.from_name ?? edge.from_name_raw ?? 'Unknown'
}

function to(edge: EdgeView): string {
  return edge.to_name ?? edge.to_name_raw ?? 'Unknown'
}

/** Convert a single edge into a readable fact sentence. */
export function edgeToFact(edge: EdgeView, entityId: string): Fact | null {
  if (!edge.document_id) return null
  const isFrom = edge.from_id === entityId
  let text: string

  switch (edge.type) {
    case 'contributed_to':
      text = `${from(edge)} contributed${amount(edge)} to ${to(edge)}${dateSuffix(edge)}.`
      break
    case 'lobbied_for':
      text = `${from(edge)} lobbied for ${to(edge)}${dateSuffix(edge)}.`
      break
    case 'lobbied_on':
      text = `${from(edge)} lobbied on ${to(edge)}${dateSuffix(edge)}.`
      break
    case 'employed_by':
      text = `${from(edge)} is employed by ${to(edge)}${edge.role ? ` as ${edge.role}` : ''}${dateSuffix(edge)}.`
      break
    case 'officer_of':
      text = `${from(edge)} is an officer of ${to(edge)}${edge.role ? ` (${edge.role})` : ''}${dateSuffix(edge)}.`
      break
    case 'director_of':
      text = `${from(edge)} is a director of ${to(edge)}${dateSuffix(edge)}.`
      break
    case 'member_of':
      text = `${from(edge)} is a member of ${to(edge)}${dateSuffix(edge)}.`
      break
    case 'appointed_to':
      text = `${from(edge)} was appointed to ${to(edge)}${dateSuffix(edge)}.`
      break
    case 'confirmed_by':
      text = `${from(edge)} was confirmed by ${to(edge)}${dateSuffix(edge)}.`
      break
    case 'testified_on':
      text = `${from(edge)} testified${edge.role ? ` (${edge.role})` : ''} on ${to(edge)}${dateSuffix(edge)}.`
      break
    case 'voted_on':
      text = `${from(edge)} voted on ${to(edge)}${edge.role ? ` (${edge.role})` : ''}${dateSuffix(edge)}.`
      break
    case 'owns':
      text = `${from(edge)} owns ${to(edge)}${amount(edge)}${dateSuffix(edge)}.`
      break
    case 'leases':
      text = `${from(edge)} leases ${to(edge)}${amount(edge)}${dateSuffix(edge)}.`
      break
    case 'disclosed_interest':
      text = `${from(edge)} disclosed a financial interest in ${to(edge)}${dateSuffix(edge)}.`
      break
    case 'awarded_contract':
      text = `${from(edge)} awarded a contract${amount(edge)} to ${to(edge)}${dateSuffix(edge)}.`
      break
    case 'awarded_grant':
      text = `${from(edge)} awarded a grant${amount(edge)} to ${to(edge)}${dateSuffix(edge)}.`
      break
    case 'spent_with':
      text = `${from(edge)} spent${amount(edge)} with ${to(edge)}${dateSuffix(edge)}.`
      break
    case 'loaned_to':
      text = `${from(edge)} loaned${amount(edge)} to ${to(edge)}${dateSuffix(edge)}.`
      break
    case 'mentioned_in':
      text = `${from(edge)} was mentioned in ${edge.doc_title ?? to(edge)}${dateSuffix(edge)}.`
      break
    default:
      text = `${from(edge)} ${edge.type.replace(/_/g, ' ')} ${to(edge)}${amount(edge)}${dateSuffix(edge)}.`
  }

  return {
    documentId: edge.document_id,
    text,
    date: dateStr(edge),
    kind: edge.type,
  }
}

/** Convert a batch of edges to facts, deduplicating by document + text. */
export function edgesToFacts(edges: EdgeView[], entityId: string): Fact[] {
  const seen = new Set<string>()
  const facts: Fact[] = []
  for (const edge of edges) {
    const fact = edgeToFact(edge, entityId)
    if (!fact) continue
    const key = `${fact.documentId}:${fact.text}`
    if (seen.has(key)) continue
    seen.add(key)
    facts.push(fact)
  }
  return facts
}

// ---------------------------------------------------------------- profile → facts

function personProfileFacts(profile: PersonProfile, entityId: string): Fact[] {
  const sections: EdgeView[][] = [
    profile.roles,
    profile.donationsGiven,
    profile.donationsReceived,
    profile.lobbying,
    profile.testimony,
    profile.boards,
    profile.property,
    profile.disclosure,
    profile.contracts,
  ]
  return edgesToFacts(sections.flat(), entityId)
}

function orgProfileFacts(profile: OrgProfile, entityId: string): Fact[] {
  const sections: EdgeView[][] = [
    profile.contributions,
    profile.lobbying,
    profile.officers,
    profile.contracts,
    profile.properties,
    profile.mentions,
  ]
  return edgesToFacts(sections.flat(), entityId)
}

/**
 * Assemble all facts for an entity by fetching its profile and converting edges.
 * Returns an empty array when the entity has no edges worth summarizing.
 */
export async function profileToFacts(db: Db, entity: EntityRow): Promise<Fact[]> {
  const id = entity.id
  if (entity.kind === 'person') {
    const profile = await getPersonProfile(db, id)
    return personProfileFacts(profile, id)
  }
  if (entity.kind === 'org') {
    const profile = await getOrgProfile(db, id)
    return orgProfileFacts(profile, id)
  }
  // bills, dockets, parcels, offices — not summarized yet
  return []
}
