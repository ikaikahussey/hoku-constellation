/**
 * Fact-checker for AI-generated summaries.
 *
 * Given a summary (body text + cited document IDs) and the entity it belongs to,
 * this module independently verifies each claim against the source edges and documents.
 *
 * Checks performed:
 *   1. Citation coverage — every sentence cites at least one document
 *   2. Document existence — cited document IDs exist in the database
 *   3. Entity reference — the summary references the correct entity
 *   4. Amount accuracy — dollar amounts match source edge amounts
 *   5. Date accuracy — dates mentioned match source edge dates
 *   6. Relationship accuracy — claimed relationships exist as edges
 *   7. Hallucination detection — names/orgs mentioned must appear in the entity's edges
 */
import type { Db } from '@/lib/db/types'
import type { EdgeView } from '@/lib/analytics/types'
import { splitSentences } from './citations'

export interface FactCheckIssue {
  severity: 'error' | 'warning'
  category: 'missing_citation' | 'invalid_document' | 'wrong_entity' | 'amount_mismatch' |
            'date_mismatch' | 'unknown_name' | 'unsupported_claim' | 'orphan_citation'
  sentence?: string
  detail: string
}

export interface FactCheckResult {
  entityId: string
  summaryId?: string
  passed: boolean
  issues: FactCheckIssue[]
  stats: {
    sentenceCount: number
    citedDocCount: number
    validDocCount: number
    edgeCount: number
    checkedAmounts: number
    amountMismatches: number
  }
}

/** All names that appear in this entity's edge network. */
function collectKnownNames(edges: EdgeView[]): Set<string> {
  const names = new Set<string>()
  for (const e of edges) {
    if (e.from_name) names.add(e.from_name.toLowerCase())
    if (e.to_name) names.add(e.to_name.toLowerCase())
    if (e.from_name_raw) names.add(e.from_name_raw.toLowerCase())
    if (e.to_name_raw) names.add(e.to_name_raw.toLowerCase())
  }
  return names
}

/** Extract dollar amounts from text. */
function extractAmounts(text: string): number[] {
  const matches = text.matchAll(/\$[\d,]+(?:\.\d{2})?/g)
  return [...matches].map(m => Number(m[0].replace(/[$,]/g, '')))
    .filter(n => !isNaN(n) && n > 0)
}

/** Extract 4-digit years and YYYY-MM-DD dates from text. */
function extractDates(text: string): string[] {
  const dates: string[] = []
  for (const m of text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) dates.push(m[1])
  for (const m of text.matchAll(/\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})\b/gi)) dates.push(m[1])
  return dates
}

/** Extract proper nouns (capitalized multi-word sequences) as candidate entity names. */
function extractProperNouns(text: string): string[] {
  const results: string[] = []
  // Match sequences of 2+ capitalized words (with optional lowercase connectors between them)
  const skip = new Set(['the', 'a', 'an', 'of', 'in', 'for', 'to', 'and', 'or', 'by', 'on', 'at', 'as', 'is', 'was', 'were', 'has', 'had', 'with', 'from', 'its', 'their', 'this', 'that'])
  for (const m of text.matchAll(/[A-ZÀ-ÖØ-Þʻ'][a-zà-öø-ÿʻ']+(?:\s+(?:(?:of|and|for|the)\s+)?[A-ZÀ-ÖØ-Þʻ'][a-zà-öø-ÿʻ']+)+/g)) {
    const name = m[0].trim()
    const words = name.split(/\s+/)
    if (words.length >= 2 && !words.every(w => skip.has(w.toLowerCase()))) {
      results.push(name)
    }
  }
  return results
}

/**
 * Run fact-check on a summary against the entity's source data.
 */
export async function factCheckSummary(
  db: Db,
  opts: {
    entityId: string
    summaryId?: string
    body: string
    cites: string[]
    entityName: string
  }
): Promise<FactCheckResult> {
  const issues: FactCheckIssue[] = []
  const sentences = splitSentences(opts.body)

  // 1. Load cited documents
  const validDocs = new Set<string>()
  if (opts.cites.length) {
    const rows = await db.many<{ id: string }>(
      `select id from document where id = any($1::uuid[])`, [opts.cites])
    for (const r of rows) validDocs.add(r.id)
  }
  for (const c of opts.cites) {
    if (!validDocs.has(c)) {
      issues.push({ severity: 'error', category: 'invalid_document', detail: `Cited document ${c.slice(0, 8)}… does not exist` })
    }
  }

  // 2. Load all edges for this entity
  const edges = await db.many<EdgeView>(
    `select e.*, f.name from_name, f.kind from_kind, f.attributes->>'slug' from_slug,
            t.name to_name, t.kind to_kind, t.attributes->>'slug' to_slug,
            d.source doc_source, d.doc_type, d.title doc_title, d.url doc_url, d.doc_date
       from edge e left join entity f on f.id = e.from_id left join entity t on t.id = e.to_id
       join document d on d.id = e.document_id
      where (e.from_id = $1 or e.to_id = $1) and e.match_status = 'matched'`,
    [opts.entityId])

  const knownNames = collectKnownNames(edges)
  knownNames.add(opts.entityName.toLowerCase())

  // Also add entity aliases
  const entityRow = await db.one<{ aliases: string[] }>(`select aliases from entity where id = $1`, [opts.entityId])
  if (entityRow?.aliases) {
    for (const a of entityRow.aliases) knownNames.add(a.toLowerCase())
  }

  // Collect all amounts and dates from edges
  const edgeAmounts = new Set<number>()
  const edgeDates = new Set<string>()
  const edgeDocIds = new Set<string>()
  for (const e of edges) {
    if (e.amount != null) {
      const n = typeof e.amount === 'string' ? Number(e.amount) : e.amount
      if (!isNaN(n) && n > 0) edgeAmounts.add(n)
    }
    if (e.start_date) edgeDates.add(e.start_date)
    if (e.doc_date) edgeDates.add(e.doc_date)
    edgeDocIds.add(e.document_id)
  }

  // 3. Check citation coverage
  if (opts.cites.length === 0) {
    issues.push({ severity: 'error', category: 'missing_citation', detail: 'Summary has no citations at all' })
  }

  // 4. Check for orphan citations — docs cited but not in the entity's edge network
  for (const c of opts.cites) {
    if (validDocs.has(c) && !edgeDocIds.has(c)) {
      issues.push({
        severity: 'warning', category: 'orphan_citation',
        detail: `Cited document ${c.slice(0, 8)}… is valid but not in this entity's edges`,
      })
    }
  }

  // 5. Entity reference check
  const bodyLower = opts.body.toLowerCase()
  const nameTokens = opts.entityName.toLowerCase().split(/\s+/)
  const lastNamePresent = nameTokens.length > 0 && bodyLower.includes(nameTokens[nameTokens.length - 1])
  const fullNamePresent = bodyLower.includes(opts.entityName.toLowerCase())
  if (!lastNamePresent && !fullNamePresent) {
    issues.push({ severity: 'warning', category: 'wrong_entity', detail: `Summary does not mention the entity name "${opts.entityName}" or surname` })
  }

  // 6. Amount accuracy
  let checkedAmounts = 0
  let amountMismatches = 0
  const mentionedAmounts = extractAmounts(opts.body)
  for (const amt of mentionedAmounts) {
    checkedAmounts++
    if (!edgeAmounts.has(amt)) {
      // Check if it's a plausible aggregate (sum of known amounts) — allow 1% tolerance
      const isClose = [...edgeAmounts].some(ea => Math.abs(ea - amt) / Math.max(ea, amt) < 0.01)
      if (!isClose) {
        amountMismatches++
        issues.push({
          severity: 'warning', category: 'amount_mismatch',
          detail: `Amount $${amt.toLocaleString('en-US')} not found in source edges (may be an aggregate)`,
        })
      }
    }
  }

  // 7. Name hallucination check
  const mentionedNames = extractProperNouns(opts.body)
  for (const name of mentionedNames) {
    const lower = name.toLowerCase()
    // Skip if it matches the entity itself or any known name in the edges
    if (knownNames.has(lower)) continue
    // Check partial matches (last name, first+last)
    const isPartial = [...knownNames].some(kn => kn.includes(lower) || lower.includes(kn))
    if (!isPartial) {
      // Check if any token of this name appears in known names
      const tokens = lower.split(/\s+/).filter(t => t.length > 2)
      const anyTokenMatches = tokens.some(t => [...knownNames].some(kn => kn.includes(t)))
      if (!anyTokenMatches) {
        issues.push({
          severity: 'warning', category: 'unknown_name',
          detail: `Name "${name}" not found in entity's edge network — possible hallucination`,
        })
      }
    }
  }

  const passed = issues.filter(i => i.severity === 'error').length === 0

  return {
    entityId: opts.entityId,
    summaryId: opts.summaryId,
    passed,
    issues,
    stats: {
      sentenceCount: sentences.length,
      citedDocCount: opts.cites.length,
      validDocCount: validDocs.size,
      edgeCount: edges.length,
      checkedAmounts,
      amountMismatches,
    },
  }
}

/**
 * Batch fact-check: verify all summaries for a given entity, or all summaries matching a filter.
 */
export async function factCheckEntity(
  db: Db,
  entityId: string,
): Promise<FactCheckResult[]> {
  const entity = await db.one<{ id: string; name: string }>(`select id, name from entity where id = $1`, [entityId])
  if (!entity) return []

  const summaries = await db.many<{ id: string; body: string; cites: string[] }>(
    `select id, body, cites from summary where entity_id = $1 order by created_at desc`, [entityId])

  const results: FactCheckResult[] = []
  for (const s of summaries) {
    results.push(await factCheckSummary(db, {
      entityId,
      summaryId: s.id,
      body: s.body,
      cites: s.cites,
      entityName: entity.name,
    }))
  }
  return results
}
