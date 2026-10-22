#!/usr/bin/env -S npx tsx --tsconfig tsconfig.scripts.json
/**
 * Batch-generate cited narrative summaries for entities.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/db/generate-summaries.ts \
 *     [--kind=person|org] [--limit=100] [--concurrency=2] [--priority-first] \
 *     [--force] [--tier=free|paid] [--status=draft|published] [--dry] [--id=<uuid>]
 *
 * For each entity: assembles a profile (edges grouped by type), converts edges to cited facts,
 * calls generateCitedNarrative, inserts the result into the summary table. Entities that already
 * have a summary are skipped unless --force is passed.
 */
import { getServiceDb, closeServiceDb } from '@/lib/db/service'
import { getPersonProfile } from '@/lib/analytics/profiles/person-profile'
import { getOrgProfile } from '@/lib/analytics/profiles/org-profile'
import { generateCitedNarrative } from '@/lib/ai/claude'
import { insertSummary } from '@/lib/db/queries/summaries'
import { edgesToFacts, profileToFacts } from '@/lib/ai/profile-facts'
import type { Db, EntityKind, EntityRow } from '@/lib/db/types'
import type { NarrativeResult } from '@/lib/ai/claude'
import type { Fact } from '@/lib/ai/citations'

const argv = process.argv.slice(2)
const flag = (f: string) => argv.includes(`--${f}`)
const value = (k: string) => argv.filter(a => a.startsWith(`--${k}=`)).map(a => a.slice(k.length + 3))[0]

const KIND = value('kind') as EntityKind | undefined
const LIMIT = Number(value('limit') || '100')
const CONCURRENCY = Number(value('concurrency') || '2')
const FORCE = flag('force')
const DRY = flag('dry')
const PRIORITY_FIRST = flag('priority-first')
const TIER = (value('tier') || 'paid') as 'free' | 'paid'
const STATUS = (value('status') || 'draft') as 'draft' | 'published'
const SINGLE_ID = value('id')

interface Stats {
  processed: number
  generated: number
  skipped: number
  errors: number
  factsOnly: number
}

async function getCandidateEntities(db: Db): Promise<EntityRow[]> {
  if (SINGLE_ID) {
    const row = await db.one<EntityRow>(`select * from entity where id = $1 and merged_into_id is null`, [SINGLE_ID])
    return row ? [row] : []
  }

  const params: unknown[] = []
  const where = [`merged_into_id is null`]

  if (KIND) {
    params.push(KIND)
    where.push(`kind = $${params.length}`)
  } else {
    where.push(`kind in ('person', 'org')`)
  }

  if (!FORCE) {
    where.push(`not exists (select 1 from summary s where s.entity_id = entity.id)`)
  }

  let order = 'name'
  if (PRIORITY_FIRST) {
    order = `(attributes->>'is_priority')::boolean desc nulls last, name`
  }

  params.push(LIMIT)
  const sql = `select * from entity where ${where.join(' and ')} order by ${order} limit $${params.length}`
  return db.many<EntityRow>(sql, params)
}

async function generateForEntity(db: Db, entity: EntityRow, stats: Stats): Promise<void> {
  const label = `[${entity.kind}] ${entity.name} (${entity.id.slice(0, 8)})`
  let facts: Fact[]
  try {
    facts = await profileToFacts(db, entity)
  } catch (e) {
    console.error(`  ✗ ${label}: profile assembly failed — ${(e as Error).message}`)
    stats.errors++
    return
  }

  if (facts.length === 0) {
    console.log(`  – ${label}: no facts, skipping`)
    stats.skipped++
    return
  }

  console.log(`  ▸ ${label}: ${facts.length} facts`)

  const taskDescription = entity.kind === 'person'
    ? `Write a concise, neutral profile summary of ${entity.name}. Cover their roles, political contributions, lobbying activity, board memberships, property holdings, and government contracts as documented.`
    : `Write a concise, neutral profile summary of the organization ${entity.name}. Cover political contributions, lobbying activity, key officers, government contracts, and property holdings as documented.`

  let result: NarrativeResult
  try {
    result = await generateCitedNarrative({
      task: taskDescription,
      facts,
      maxSentences: 8,
      rules: [
        'Write for HOKU Insider readers: journalists, lobbyists, and civic researchers in Hawaiʻi.',
        'Use full names on first mention; surname only after.',
        'Amounts in USD with commas. Dates as Month YYYY when only the year and month are known.',
        'Do not editorialize or speculate. State only what the cited documents show.',
      ],
    })
  } catch (e) {
    console.error(`  ✗ ${label}: narrative generation failed — ${(e as Error).message}`)
    stats.errors++
    return
  }

  if (result.insufficient && result.sentences.length === 0) {
    console.log(`  – ${label}: model reported insufficient facts`)
    stats.skipped++
    return
  }

  const body = result.sentences.map(s => s.text).join(' ')
  const cites = [...new Set(result.sentences.flatMap(s => s.documentIds))]

  if (DRY) {
    console.log(`  ✓ ${label}: [DRY] ${result.source}, ${result.sentences.length} sentences, ${cites.length} cites, ${result.attempts} attempt(s)`)
    if (result.errors.length) console.log(`    warnings: ${result.errors.join('; ')}`)
    console.log(`    ${body.slice(0, 200)}${body.length > 200 ? '…' : ''}`)
    stats.generated++
    if (result.source === 'facts_only') stats.factsOnly++
    return
  }

  try {
    await insertSummary(db, {
      entity_id: entity.id,
      body,
      cites,
      author: `model:${result.model ?? 'unknown'}`,
      status: STATUS,
      tier: TIER,
    })
    console.log(`  ✓ ${label}: ${result.source}, ${result.sentences.length} sentences, ${cites.length} cites`)
    if (result.errors.length) console.log(`    warnings: ${result.errors.join('; ')}`)
    stats.generated++
    if (result.source === 'facts_only') stats.factsOnly++
  } catch (e) {
    console.error(`  ✗ ${label}: insert failed — ${(e as Error).message}`)
    stats.errors++
  }
}

async function runBatch(db: Db, entities: EntityRow[]): Promise<Stats> {
  const stats: Stats = { processed: 0, generated: 0, skipped: 0, errors: 0, factsOnly: 0 }
  const queue = [...entities]

  async function worker() {
    while (queue.length) {
      const entity = queue.shift()!
      stats.processed++
      await generateForEntity(db, entity, stats)
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker())
  await Promise.all(workers)
  return stats
}

;(async () => {
  const db = await getServiceDb()
  try {
    console.log(`generate-summaries: kind=${KIND ?? 'person,org'} limit=${LIMIT} concurrency=${CONCURRENCY} tier=${TIER} status=${STATUS} force=${FORCE} dry=${DRY}`)

    const entities = await getCandidateEntities(db)
    console.log(`Found ${entities.length} entities to process\n`)

    if (!entities.length) {
      console.log('Nothing to do.')
      return
    }

    const stats = await runBatch(db, entities)
    console.log(`\n--- Summary ---`)
    console.log(`Processed: ${stats.processed}`)
    console.log(`Generated: ${stats.generated} (${stats.factsOnly} facts-only fallbacks)`)
    console.log(`Skipped:   ${stats.skipped}`)
    console.log(`Errors:    ${stats.errors}`)
  } finally {
    await closeServiceDb()
  }
})()
