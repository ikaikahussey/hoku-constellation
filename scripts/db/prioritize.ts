#!/usr/bin/env -S npx tsx --tsconfig tsconfig.scripts.json
/**
 * Flag people or organizations as priority; optionally feature them, watch them from a team, and run
 * the priority import pass right away.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/db/prioritize.ts \
 *     --person="Andy Winer|Andrew Winer" --person="Paul Yonamine|Paul K. Yonamine" \
 *     [--org="Name|Alias"] [--id=<uuid> (applies to the single --person/--org given)] \
 *     [--feature] [--watch-email=<member email> | --watch-team=<team uuid>] [--import] [--create] [--dry]
 *
 * The first name in each --person/--org is the display name; the rest are aliases added to the entity
 * (spellings used in filings, nicknames). Names that match several entities are listed and skipped;
 * rerun with --id. Missing entities are created only with --create. Undo with --clear.
 */
import { getServiceDb, closeServiceDb } from '@/lib/db/service'
import { dryDb } from '@/lib/import/dry'
import { runPriorityPassIfDue } from '@/lib/import/priority'
import { resolvePrioritySpec, markPriority, clearPriority, watchForTeam, userIdForEmail, PRIORITY_WATCHLIST, type PrioritySpec } from '@/lib/ops/priority'

const argv = process.argv.slice(2)
const flag = (f: string) => argv.includes(`--${f}`)
const values = (k: string) => argv.filter(a => a.startsWith(`--${k}=`)).map(a => a.slice(k.length + 3))
const value = (k: string) => values(k)[0]

const specs: PrioritySpec[] = [
  ...values('person').map(v => ({ kind: 'person' as const, names: v.split('|').map(s => s.trim()).filter(Boolean) })),
  ...values('org').map(v => ({ kind: 'org' as const, names: v.split('|').map(s => s.trim()).filter(Boolean) })),
]
if (!specs.length) { console.error('usage: prioritize.ts --person="Name|Alias" [--org=...] [--feature] [--watch-email=...] [--import] [--dry]'); process.exit(2) }
if (value('id')) {
  if (specs.length !== 1) { console.error('--id applies to exactly one --person or --org'); process.exit(2) }
  specs[0].id = value('id')
}

;(async () => {
  const real = await getServiceDb()
  const db = flag('dry') ? dryDb(real) : real
  try {
    const ids: string[] = []
    for (const spec of specs) {
      const r = await resolvePrioritySpec(db, spec, { create: flag('create') })
      if (r.status === 'found' || r.status === 'created') {
        if (flag('clear')) await clearPriority(db, r.entityId)
        else await markPriority(db, r.entityId, spec.names, { feature: flag('feature') })
        ids.push(r.entityId)
        console.log(`${r.status === 'created' ? 'created' : 'found'}: ${r.name} (${r.entityId})${flag('clear') ? ' — priority cleared' : ' — priority set'}${flag('feature') && !flag('clear') ? ', featured' : ''}`)
      } else {
        console.log(`${r.status}: ${spec.names[0]}${r.status === 'missing' ? ' (rerun with --create to add a profile)' : ' (rerun with --id=<uuid>)'}`)
        for (const c of 'candidates' in r ? r.candidates : []) console.log(`   ${Math.round(c.confidence * 100)}%  ${c.name}  ${c.id}`)
      }
    }
    if (ids.length && !flag('clear') && (value('watch-email') || value('watch-team'))) {
      const email = value('watch-email')
      const userId = email ? await userIdForEmail(db, email) : undefined
      if (email && !userId) throw new Error(`No team member with email ${email}`)
      const w = await watchForTeam(db, ids, { teamId: value('watch-team'), userId: userId ?? undefined })
      console.log(`watchlist "${PRIORITY_WATCHLIST}" in team ${w.teamName} (${w.teamId}): ${w.added} added`)
      console.log(w.ruleId ? `email alert rule: ${w.ruleId}` : w.ruleError ? `email alert rule not created: ${w.ruleError}` : 'no alert rule (use --watch-email to create one)')
    }
    if (ids.length && !flag('clear') && flag('import')) {
      const s = await runPriorityPassIfDue(db, { force: true, log: m => console.log(`[priority] ${m}`) })
      if (s) console.log(`priority import: documents=${s.documents} edges=${s.edges} errors=${s.errors}`)
    }
  } finally {
    await closeServiceDb()
  }
})().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
