/**
 * Runs the port against the in-repo legacy sample dataset (PGlite) and writes docs/PORT_RECONCILIATION.md.
 * The production section of that document is regenerated at rehearsal/cutover with
 *   npx tsx scripts/db/port-legacy.ts --markdown docs/PORT_RECONCILIATION.md
 */
import { writeFileSync } from 'node:fs'
import { createTestDb } from '../../tests/helpers/pglite'
import { loadLegacySchema, seedLegacy } from '../../tests/helpers/legacy'
import { runPort, reconcile, checkReconciliation, toMarkdown } from './port-legacy'

async function main() {
  const db = await createTestDb()
  await loadLegacySchema(db)
  await seedLegacy(db)
  const first = (await runPort(db, sql => db.exec(sql))).inserted
  const second = (await runPort(db, sql => db.exec(sql))).inserted
  const rows = await reconcile(db)
  const problems = checkReconciliation(rows)
  const md = toMarkdown(rows, { inserted: first, secondRun: second, problems, generatedAt: new Date().toISOString() })
  const header = `> **Sample-dataset run.** This report was produced from the in-repo legacy fixture (tests/helpers/legacy.ts) on PGlite because the build container cannot reach Neon or Supabase. At rehearsal and again at cutover, regenerate it against the real \`legacy\` schema with \`npx tsx scripts/db/port-legacy.ts --markdown docs/PORT_RECONCILIATION.md\`. The production legacy row counts to reconcile against are recorded in docs/MIGRATION_INVENTORY.md §5 (person 33,724; organization 717; relationship 6; contribution 221,344 / Σ $159,536,564.20; lobbyist_registration 3,932; puc_docket 12; puc_participant 22; timeline_event 7; government_contract 100 / Σ $14,663,541,674.00; data_source_record 107; import_cursor 7; all other tables 0).\n\n`
  writeFileSync('docs/PORT_RECONCILIATION.md', md.replace('\n\nGenerated', `\n\n${header}Generated`))
  await db.end()
  console.log(md)
  if (problems.length) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
