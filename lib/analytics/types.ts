/**
 * Shared types for the analytics module.
 * Kept deliberately loose (unknown/Record) where Supabase rows are passed through.
 */

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

export type EdgeType =
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
  entity_type?: 'person' | 'organization'
}

export interface GraphLink {
  source: string
  target: string
  type: EdgeType | string
  value: number
}

export interface AlertRecord {
  alert_type: string
  severity: 'high' | 'medium' | 'low'
  person_id?: string | null
  organization_id?: string | null
  headline: string
  detail: Record<string, unknown>
  source_records: Array<Record<string, unknown>>
}

export interface PersonProfile {
  person: Record<string, unknown>
  roles: Array<Record<string, unknown>>
  donationsGiven: Array<Record<string, unknown>>
  donationsReceived: Array<Record<string, unknown>>
  lobbying: Array<Record<string, unknown>>
  testimony: Array<Record<string, unknown>>
  boards: Array<Record<string, unknown>>
  property: Array<Record<string, unknown>>
  disclosure: Array<Record<string, unknown>>
  contracts: Array<Record<string, unknown>>
  score: ScoreBreakdown | null
  connections: Array<Record<string, unknown>>
  alerts: Array<Record<string, unknown>>
}

export interface OrgProfile {
  organization: Record<string, unknown>
  contributions: Array<Record<string, unknown>>
  lobbying: Array<Record<string, unknown>>
  officers: Array<Record<string, unknown>>
  contracts: Array<Record<string, unknown>>
  properties: Array<Record<string, unknown>>
  mentions: Array<Record<string, unknown>>
}
