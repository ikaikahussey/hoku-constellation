/**
 * Helpers for rendering canonical edges (lib/db/queries/edges.ts) on public profile pages.
 * See docs/EDGE_TYPES.md for the vocabulary and the paid/public split.
 */
import type { EdgeWithEnds } from '@/lib/db/queries/edges'
import type { EntityRow } from '@/lib/db/types'
import { entityHref } from '@/components/search/EntityCard'

/** Public position / membership / legislative / regulatory edge types shown under Connections. */
export const POSITION_TYPES = [
  'employed_by', 'officer_of', 'director_of', 'member_of', 'appointed_to', 'confirmed_by',
  'sponsored', 'voted_on', 'party_to', 'licensed_by', 'sanctioned_by',
] as const

export const TYPE_LABELS: Record<string, string> = {
  employed_by: 'Employment',
  officer_of: 'Officer roles',
  director_of: 'Board seats',
  member_of: 'Memberships',
  appointed_to: 'Appointments',
  confirmed_by: 'Confirmations',
  sponsored: 'Sponsored measures',
  voted_on: 'Votes',
  party_to: 'Regulatory dockets',
  licensed_by: 'Licenses',
  sanctioned_by: 'Enforcement actions',
  mentioned_in: 'Mentions',
  contributed_to: 'Contributions',
  spent_with: 'Expenditures',
  loaned_to: 'Loans',
  lobbied_for: 'Lobbying clients',
  lobbied_on: 'Lobbied measures',
  disclosed_interest: 'Disclosed interests',
  testified_on: 'Testimony',
  awarded_contract: 'Contracts',
  awarded_grant: 'Grants',
  owns: 'Property',
  leases: 'Leases',
}

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.replace(/_/g, ' ')
}

export interface EdgeEnd {
  id: string | null
  name: string
  kind: string | null
  slug: string | null
  href: string | null
}

/** The party on the far side of an edge relative to `entityId`. */
export function otherEnd(edge: EdgeWithEnds, entityId: string): EdgeEnd {
  const isFrom = edge.from_id === entityId
  const id = isFrom ? edge.to_id : edge.from_id
  const name = (isFrom ? edge.to_name ?? edge.to_name_raw : edge.from_name ?? edge.from_name_raw) ?? 'Unknown'
  const kind = isFrom ? edge.to_kind : edge.from_kind
  const slug = isFrom ? edge.to_slug : edge.from_slug
  return { id, name, kind, slug, href: id ? entityHref(kind, slug, id) : null }
}

/** An edge is current when it has no end date in the past and is not flagged is_current=false. */
export function isCurrent(edge: EdgeWithEnds): boolean {
  if (edge.attributes && edge.attributes.is_current === false) return false
  if (!edge.end_date) return true
  return new Date(edge.end_date).getTime() >= Date.now()
}

export function attr(entity: EntityRow, key: string): string | null {
  const v = entity.attributes?.[key]
  return typeof v === 'string' && v.length ? v : null
}

export function attrList(entity: EntityRow, key: string): string[] {
  const v = entity.attributes?.[key]
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export function formatYear(date: string | null): string {
  if (!date) return ''
  const y = new Date(date).getFullYear()
  return Number.isNaN(y) ? '' : String(y)
}

export function dateRange(edge: EdgeWithEnds): string {
  const start = formatYear(edge.start_date)
  const end = edge.end_date ? formatYear(edge.end_date) : (start ? 'present' : '')
  if (!start && !end) return ''
  return end ? `${start || '?'}–${end}` : start
}
