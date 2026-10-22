#!/usr/bin/env -S npx tsx --tsconfig tsconfig.scripts.json
/**
 * Fact-check existing summaries against their source edges.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/db/fact-check-summaries.ts \
 *     [--id=<entity-uuid>] [--kind=person|org] [--limit=100] [--status=draft|published]
 *     [--errors-only] [--json]
 *
 * Without --id, checks the most recent summary for each entity matching the filters.
 */
import { getServiceDb, closeServiceDb } from '@/lib/db/service'
import { factCheckSummary, type FactCheckResult } from '@/lib/ai/fact-check'
import type { Db, EntityKind } from '@/lib/db/types'

const argv = process.argv.slice(2)
const flag = (f: string) => argv.includes(`--${f}`)
const value = (k: string) => argv.filter(a => a.startsWith(`--${k}=`)).map(a => a.slice(k.length + 3))[0]

const SINGLE_ID = value('id')
const KIND = value('kind') as EntityKind | undefined
const LIMIT = Number(value('limit') || '100')
const STATUS = value('status') || undefined
const ERRORS_ONLY = flag('errors-only')
const JSON_OUTPUT = flag('json')

interface SummaryWithEntity {
  id: string
  entity_id: string
  body: string
  cites: string[]
  entity_name: string
  entity_kind: EntityKind
}

async function getSummariesToCheck(db: Db): Promise<SummaryWithEntity[]> {
  const params: unknown[] = []
  const where: string[] = []

  if (SINGLE_ID) {
    params.push(SINGLE_ID)
    where.push(`s.entity_id = $${params.length}`)
  }
  if (KIND) {
    params.push(KIND)
    where.push(`e.kind = $${params.length}`)
  }
  if (STATUS) {
    params.push(STATUS)
    where.push(`s.status = $${params.length}`)
  }

  where.push(`s.entity_id is not null`)

  params.push(LIMIT)
  const sql = `
    select distinct on (s.entity_id)
      s.id, s.entity_id, s.body, s.cites, e.name as entity_name, e.kind as entity_kind
    from summary s join entity e on e.id = s.entity_id
    where ${where.join(' and ')}
    order by s.entity_id, s.created_at desc
    limit $${params.length}`

  return db.many<SummaryWithEntity>(sql, params)
}

;(async () => {
  const db = await getServiceDb()
  try {
    const summaries = await getSummariesToCheck(db)
    if (!JSON_OUTPUT) {
      console.log(`Fact-checking ${summaries.length} summaries...\n`)
    }

    const results: FactCheckResult[] = []
    let passCount = 0
    let failCount = 0

    for (const s of summaries) {
      const result = await factCheckSummary(db, {
        entityId: s.entity_id,
        summaryId: s.id,
        body: s.body,
        cites: s.cites,
        entityName: s.entity_name,
      })
      results.push(result)

      if (result.passed) passCount++
      else failCount++

      if (JSON_OUTPUT) continue
      if (ERRORS_ONLY && result.passed) continue

      const icon = result.passed ? '✓' : '✗'
      const errors = result.issues.filter(i => i.severity === 'error').length
      const warnings = result.issues.filter(i => i.severity === 'warning').length
      console.log(`${icon} [${s.entity_kind}] ${s.entity_name} — ${errors} errors, ${warnings} warnings (${result.stats.sentenceCount} sentences, ${result.stats.edgeCount} edges)`)
      for (const issue of result.issues) {
        const sev = issue.severity === 'error' ? '  ✗' : '  ⚠'
        console.log(`${sev} [${issue.category}] ${issue.detail}`)
      }
      if (result.issues.length) console.log()
    }

    if (JSON_OUTPUT) {
      console.log(JSON.stringify({ total: results.length, passed: passCount, failed: failCount, results }, null, 2))
    } else {
      console.log(`\n--- Fact-check summary ---`)
      console.log(`Total:  ${results.length}`)
      console.log(`Passed: ${passCount}`)
      console.log(`Failed: ${failCount}`)
    }
  } finally {
    await closeServiceDb()
  }
})()
