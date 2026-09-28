/**
 * Database access interfaces shared by lib/analytics, lib/import, workers, and API routes.
 *
 * `Db` is the privileged, direct-Postgres interface (owner or ingest_writer role). Implemented by
 *   - lib/db/service.ts        → @neondatabase/serverless Pool (Vercel) or `pg` Pool (workers)
 *   - tests/helpers/pglite.ts  → PGlite (in-process Postgres for tests)
 *
 * Analytics functions take a `Db` as their first argument and never construct one.
 */

export type SqlParam = string | number | boolean | null | Date | string[] | number[] | Record<string, unknown> | unknown[]

export interface QueryResult<T> {
  rows: T[]
  rowCount: number
}

export interface Db {
  /** Run a parameterized query ($1, $2, …) and return rows. */
  query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<QueryResult<T>>
  /** Convenience: first row or null. */
  one<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<T | null>
  /** Convenience: all rows. */
  many<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<T[]>
  /** Run `fn` inside a transaction with a dedicated connection. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>
  /** Release pooled connections (workers / tests). */
  end(): Promise<void>
}

// ---------------------------------------------------------------- row types (generated shape)

export type EntityKind = 'person' | 'org' | 'bill' | 'docket' | 'parcel' | 'office'
export type MatchStatus = 'matched' | 'review' | 'unmatched'

export interface EntityRow {
  id: string
  kind: EntityKind
  name: string
  aliases: string[]
  identifiers: Record<string, string>
  attributes: Record<string, unknown>
  merged_into_id: string | null
  created_at: string
  updated_at: string
}

export interface DocumentRow {
  id: string
  source: string
  source_record_id: string | null
  doc_type: string
  url: string | null
  title: string | null
  doc_date: string | null
  raw: Record<string, unknown>
  body_text: string | null
  checksum: string
  fetched_at: string
}

export interface EdgeRow {
  id: string
  type: string
  from_id: string | null
  to_id: string | null
  from_name_raw: string | null
  to_name_raw: string | null
  role: string | null
  amount: string | number | null
  start_date: string | null
  end_date: string | null
  document_id: string
  match_status: MatchStatus
  match_confidence: number | null
  attributes: Record<string, unknown>
}

export interface SummaryRow {
  id: string
  entity_id: string | null
  edge_id: string | null
  document_id: string | null
  body: string
  cites: string[]
  author: string
  status: 'draft' | 'published'
  tier: 'free' | 'paid'
  created_at: string
}

export interface UserAccountRow {
  user_id: string
  subscription_tier: 'free' | 'individual' | 'professional' | 'institutional'
  subscription_status: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  trial_ends_at: string | null
  watch_entity_ids: string[]
  is_staff: boolean
  created_at: string
}

export interface ImportCursorRow {
  source: string
  cursor_offset: number | null
  last_run_at: string | null
  status: string | null
  metadata: Record<string, unknown> | null
}

export interface InfluenceScoreRow {
  entity_id: string
  composite_score: string | number
  political_money_score: string | number
  institutional_position_score: string | number
  lobbying_score: string | number
  economic_footprint_score: string | number
  network_centrality_score: string | number
  public_visibility_score: string | number
  rank: number | null
  percentile: string | number | null
  computed_at: string
  score_version: number
}

export interface DerivedEdgeRow {
  id: string
  source_entity_id: string
  target_entity_id: string
  relationship_type: string
  weight: string | number
  evidence: unknown
}

export interface AlertRow {
  id: string
  alert_type: string
  severity: 'high' | 'medium' | 'low'
  entity_id: string | null
  headline: string
  detail: Record<string, unknown>
  source_records: Array<Record<string, unknown>>
  created_at: string
  acknowledged: boolean
}
