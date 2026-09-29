/**
 * Kind-specific validation for the core schema. One zod schema per entity.kind,
 * document.doc_type, and edge.type. Ingestion and admin writes call
 * `validateEntityAttributes`, `validateDocument`, `validateEdge` before inserting.
 *
 * Keep this file in sync with docs/EDGE_TYPES.md and the check constraints in
 * db/migrations/001_core_schema.sql.
 */
import { z } from 'zod'

// ---------------------------------------------------------------- shared

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
const nullableDate = isoDate.nullable().optional()
const uuid = z.string().uuid()

export const ENTITY_KINDS = ['person', 'org', 'bill', 'docket', 'parcel', 'office'] as const
export type EntityKind = (typeof ENTITY_KINDS)[number]

export const EDGE_TYPES = [
  'contributed_to', 'spent_with', 'loaned_to',
  'lobbied_for', 'lobbied_on',
  'employed_by', 'officer_of', 'director_of', 'member_of',
  'appointed_to', 'confirmed_by',
  'sponsored', 'voted_on', 'testified_on',
  'awarded_contract', 'awarded_grant',
  'owns', 'leases', 'party_to',
  'disclosed_interest', 'licensed_by', 'sanctioned_by',
  'mentioned_in',
] as const
export type EdgeType = (typeof EDGE_TYPES)[number]

export const DOC_TYPES = [
  // money
  'contribution', 'expenditure', 'loan',
  // lobbying / ethics
  'lobbyist_registration', 'lobbyist_expenditure', 'financial_disclosure', 'gift_disclosure', 'ethics_charge',
  // legislature
  'measure', 'testimony', 'vote', 'committee_roster', 'governors_message', 'grant_in_aid',
  // executive / boards
  'appointment', 'executive_order', 'proclamation', 'agenda',
  // procurement / federal
  'contract', 'grant', 'exclusion', 'debarment', 'sole_source_notice', 'entity_registration',
  // property / regulatory
  'property_record', 'docket_filing', 'license', 'enforcement_action', 'lease',
  // corporate
  'business_registration', 'sec_filing', 'irs_990', 'lda_filing',
  // elections
  'candidate_filing', 'election_result',
  // editorial / misc
  'article', 'event', 'source_record', 'record', 'permit',
] as const
export type DocType = (typeof DOC_TYPES)[number]

export const MATCH_STATUSES = ['matched', 'review', 'unmatched'] as const
export type MatchStatus = (typeof MATCH_STATUSES)[number]

// ---------------------------------------------------------------- entity attributes

const baseEntityAttributes = z.object({
  slug: z.string().min(1).optional(),
  visibility: z.enum(['public', 'gated']).optional(),
  status: z.string().optional(),
  is_featured: z.boolean().optional(),
  /** Staff priority: records are collected first (lib/import/priority.ts) and sorted first in match review. */
  is_priority: z.boolean().optional(),
  description: z.string().optional(),
  website_url: z.string().optional(),
  island: z.string().optional(),
  legacy_id: uuid.optional(),
  legacy_table: z.string().optional(),
})

export const personAttributes = baseEntityAttributes.extend({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  entity_types: z.array(z.string()).optional(),
  office_held: z.string().nullable().optional(),
  party: z.string().nullable().optional(),
  district: z.string().nullable().optional(),
  term_start: nullableDate,
  term_end: nullableDate,
  bio_summary: z.string().nullable().optional(),
  photo_url: z.string().nullable().optional(),
}).passthrough()

export const orgAttributes = baseEntityAttributes.extend({
  org_type: z.string().optional(),
  sector: z.string().nullable().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  registration_status: z.string().optional(),
}).passthrough()

export const billAttributes = baseEntityAttributes.extend({
  measure_number: z.string(),          // e.g. "SB1234"
  session: z.string(),                 // e.g. "2026"
  chamber: z.enum(['H', 'S', 'GM', 'other']).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  current_status: z.string().optional(),
  introduced_date: nullableDate,
  measure_type: z.string().optional(),
  jurisdiction: z.string().optional(), // 'state' | 'honolulu' | 'maui' | 'hawaii' | 'kauai' | 'federal'
}).passthrough()

export const docketAttributes = baseEntityAttributes.extend({
  docket_number: z.string(),
  agency: z.string(),                  // 'PUC' | 'LUC' | 'DCCA-CATV' | ...
  title: z.string().optional(),
  docket_type: z.string().optional(),
  docket_status: z.string().optional(),
  filed_date: nullableDate,
  decision_date: nullableDate,
  utility_type: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
}).passthrough()

export const parcelAttributes = baseEntityAttributes.extend({
  tmk: z.string().regex(/^[1-4]/, 'TMK must start with the county digit 1–4'),
  county: z.enum(['Honolulu', 'Maui', 'Hawaii', 'Kauai']).optional(),
  address: z.string().nullable().optional(),
  tax_class: z.string().nullable().optional(),
  assessed_value: z.number().nullable().optional(),
  assessment_year: z.number().int().nullable().optional(),
  land_area_sqft: z.number().nullable().optional(),
}).passthrough()

export const officeAttributes = baseEntityAttributes.extend({
  office_type: z.enum(['board', 'commission', 'elected_office', 'agency', 'committee', 'court']),
  jurisdiction: z.string().optional(),
  parent_agency: z.string().optional(),
  seat_count: z.number().int().optional(),
}).passthrough()

export const entityAttributeSchemas: Record<EntityKind, z.ZodTypeAny> = {
  person: personAttributes,
  org: orgAttributes,
  bill: billAttributes,
  docket: docketAttributes,
  parcel: parcelAttributes,
  office: officeAttributes,
}

// Identifiers: scheme → value. Values are strings; known schemes are typed loosely so new
// sources can add schemes without a migration.
export const identifiersSchema = z.record(z.string().min(1), z.string().min(1))

export const entityInsertSchema = z.object({
  kind: z.enum(ENTITY_KINDS),
  name: z.string().trim().min(1),
  aliases: z.array(z.string()).default([]),
  identifiers: identifiersSchema.default({}),
  attributes: z.record(z.string(), z.unknown()).default({}),
}).superRefine((val, ctx) => {
  const res = entityAttributeSchemas[val.kind].safeParse(val.attributes)
  if (!res.success) {
    for (const issue of res.error.issues) {
      ctx.addIssue({ ...issue, path: ['attributes', ...issue.path] })
    }
  }
})
export type EntityInsert = z.infer<typeof entityInsertSchema>

export function validateEntityAttributes(kind: EntityKind, attributes: unknown) {
  return entityAttributeSchemas[kind].parse(attributes)
}

// ---------------------------------------------------------------- documents

export const documentInsertSchema = z.object({
  source: z.string().min(1),
  source_record_id: z.string().min(1).nullable().optional(),
  doc_type: z.enum(DOC_TYPES),
  url: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  doc_date: isoDate.nullable().optional(),
  raw: z.record(z.string(), z.unknown()).or(z.array(z.unknown())),
  body_text: z.string().nullable().optional(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/, 'sha256 hex'),
})
export type DocumentInsert = z.infer<typeof documentInsertSchema>

export function validateDocument(doc: unknown): DocumentInsert {
  return documentInsertSchema.parse(doc)
}

// ---------------------------------------------------------------- edge attributes

const money = z.object({
  election_period: z.string().nullable().optional(),
  contribution_type: z.string().nullable().optional(),
  non_monetary: z.boolean().optional(),
  period: z.string().nullable().optional(),
  source: z.string().optional(),
}).passthrough()

const position = z.object({
  is_current: z.boolean().optional(),
  appointed_by: z.string().optional(),
  source_description: z.string().nullable().optional(),
  legacy_relationship_type: z.string().optional(),
}).passthrough()

export const edgeAttributeSchemas: Record<EdgeType, z.ZodTypeAny> = {
  contributed_to: money,
  spent_with: money,
  loaned_to: money.extend({ interest_rate: z.number().optional() }),
  lobbied_for: z.object({ lobby_year: z.string().optional(), issues: z.array(z.string()).optional(), firm: z.string().nullable().optional() }).passthrough(),
  lobbied_on: z.object({ issue: z.string().optional(), position: z.string().optional() }).passthrough(),
  employed_by: position,
  officer_of: position,
  director_of: position,
  member_of: position,
  appointed_to: position.extend({ term_end: nullableDate }),
  confirmed_by: z.object({ gm_number: z.string().optional(), vote: z.string().optional() }).passthrough(),
  sponsored: z.object({ session: z.string().optional() }).passthrough(),
  voted_on: z.object({ committee: z.string().optional(), vote_type: z.enum(['committee', 'floor']).optional(), session: z.string().optional() }).passthrough(),
  testified_on: z.object({ committee: z.string().nullable().optional(), hearing_date: nullableDate, session: z.string().optional(), testimony_url: z.string().nullable().optional() }).passthrough(),
  awarded_contract: z.object({ solicitation_id: z.string().optional(), method: z.string().optional(), description: z.string().nullable().optional(), awarding_agency: z.string().optional() }).passthrough(),
  awarded_grant: z.object({ program: z.string().optional(), description: z.string().nullable().optional() }).passthrough(),
  owns: z.object({ assessed_value: z.number().nullable().optional(), assessment_year: z.number().int().nullable().optional(), tax_class: z.string().nullable().optional() }).passthrough(),
  leases: z.object({ lease_type: z.string().optional(), annual_rent: z.number().nullable().optional() }).passthrough(),
  party_to: z.object({}).passthrough(),
  disclosed_interest: z.object({ filing_year: z.number().int().optional(), value_range: z.string().optional(), position_held: z.string().nullable().optional() }).passthrough(),
  licensed_by: z.object({ license_number: z.string().optional(), status: z.string().optional() }).passthrough(),
  sanctioned_by: z.object({ case_number: z.string().optional(), action: z.string().optional() }).passthrough(),
  mentioned_in: z.object({ mention_type: z.string().optional(), event_type: z.string().optional() }).passthrough(),
}

export const edgeInsertSchema = z.object({
  type: z.enum(EDGE_TYPES),
  from_id: uuid.nullable().optional(),
  to_id: uuid.nullable().optional(),
  from_name_raw: z.string().nullable().optional(),
  to_name_raw: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  amount: z.number().finite().nullable().optional(),
  start_date: isoDate.nullable().optional(),
  end_date: isoDate.nullable().optional(),
  document_id: uuid,
  match_status: z.enum(MATCH_STATUSES).default('unmatched'),
  match_confidence: z.number().min(0).max(1).nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).default({}),
}).superRefine((val, ctx) => {
  if (val.type !== 'mentioned_in' && !val.to_id && !val.to_name_raw) {
    ctx.addIssue({ code: 'custom', path: ['to_id'], message: 'edge needs to_id or to_name_raw' })
  }
  if (!val.from_id && !val.from_name_raw) {
    ctx.addIssue({ code: 'custom', path: ['from_id'], message: 'edge needs from_id or from_name_raw' })
  }
  const res = edgeAttributeSchemas[val.type].safeParse(val.attributes)
  if (!res.success) {
    for (const issue of res.error.issues) ctx.addIssue({ ...issue, path: ['attributes', ...issue.path] })
  }
})
export type EdgeInsert = z.infer<typeof edgeInsertSchema>

export function validateEdge(edge: unknown): EdgeInsert {
  return edgeInsertSchema.parse(edge)
}

export function validateEdgeAttributes(type: EdgeType, attributes: unknown) {
  return edgeAttributeSchemas[type].parse(attributes)
}
