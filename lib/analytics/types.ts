/**
 * Shared types for the analytics module. All analytics functions read the core schema
 * (entity / document / edge / summary) through a `Db` and write only ax_* tables.
 */
import type { EdgeRow, EntityRow, InfluenceScoreRow, AlertRow } from '@/lib/db/types'

export interface ScoreBreakdown {
  composite: number
  political_money: number
  institutional_position: number
  lobbying: number
  economic_footprint: number
  network_centrality: number
  public_visibility: number
}

export interface DimensionResult {
  value: number
  evidence: Record<string, unknown>
}

/** Derived (analytical) edge types written to ax_relationship_edge. Distinct from canonical edge.type. */
export type DerivedEdgeType =
  | 'co_donor'
  | 'donor_candidate'
  | 'co_board_member'
  | 'lobbyist_client_officer'
  | 'co_testimony'
  | 'opposing_testimony'
  | 'shared_organization'
  | 'contractor_agency'

export interface GraphNode {
  id: string
  label: string
  group?: string
  score?: number
  kind?: EntityRow['kind']
  /** @deprecated use kind */
  entity_type?: 'person' | 'organization'
}

export interface GraphLink {
  source: string
  target: string
  type: DerivedEdgeType | string
  value: number
}

export interface AlertRecord {
  alert_type: string
  severity: 'high' | 'medium' | 'low'
  entity_id?: string | null
  headline: string
  detail: Record<string, unknown>
  source_records: Array<Record<string, unknown>>
}

export interface EdgeView extends EdgeRow {
  from_name: string | null
  from_kind: string | null
  from_slug: string | null
  to_name: string | null
  to_kind: string | null
  to_slug: string | null
  doc_source: string
  doc_type: string
  doc_title: string | null
  doc_url: string | null
  doc_date: string | null
}

export interface PersonProfile {
  entity: EntityRow | null
  /** @deprecated alias of entity */
  person: EntityRow | null
  roles: EdgeView[]
  donationsGiven: EdgeView[]
  donationsReceived: EdgeView[]
  lobbying: EdgeView[]
  testimony: EdgeView[]
  boards: EdgeView[]
  property: EdgeView[]
  disclosure: EdgeView[]
  contracts: EdgeView[]
  score: ScoreBreakdown | null
  connections: Array<Record<string, unknown>>
  alerts: AlertRow[]
}

export interface OrgProfile {
  entity: EntityRow | null
  /** @deprecated alias of entity */
  organization: EntityRow | null
  contributions: EdgeView[]
  lobbying: EdgeView[]
  officers: EdgeView[]
  contracts: EdgeView[]
  properties: EdgeView[]
  mentions: EdgeView[]
}

export type { InfluenceScoreRow, AlertRow }
