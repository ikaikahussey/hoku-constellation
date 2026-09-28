#!/usr/bin/env -S npx tsx --tsconfig tsconfig.scripts.json
/**
 * Compares two parity snapshots and prints every differing path. Expected, explained differences
 * (see docs/PORT_RECONCILIATION.md) are classified so the unexplained remainder stands out:
 *   - relationship_type → type renames per docs/EDGE_TYPES.md
 *   - match_status 'recipient_matched' / 'donor_matched' → 'review'
 *   - legacy column names (full_name → name, canonical ids) on the v1 API
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/db/parity-diff.ts parity/before.json parity/after.json [--json]
 * Exit code 1 when unexplained differences remain.
 */
import { readFileSync } from 'node:fs'

export interface Diff { entity: string; endpoint: string; path: string; before: unknown; after: unknown; explained: string | null }

const LEGACY_TYPE_MAP: Record<string, string> = {
  officer: 'officer_of', director: 'director_of', board_member: 'director_of', member: 'member_of', employee: 'employed_by', lobbyist: 'lobbied_for',
  appointed_to: 'appointed_to', contributor: 'contributed_to', owner: 'owns', party: 'party_to', subsidiary: 'subsidiary_of', affiliate: 'affiliated_with',
}
const LEGACY_STATUS = new Set(['recipient_matched', 'donor_matched', 'partial'])
const RENAMED_KEYS: Record<string, string> = { full_name: 'name', canonical_name: 'name', relationship_type: 'type', source_person_id: 'from_id', target_person_id: 'to_id', source_org_id: 'from_id', target_org_id: 'to_id' }

export function explain(path: string, before: unknown, after: unknown): string | null {
  const key = path.split('.').pop() ?? ''
  if ((key === 'relationship_type' || key === 'type') && typeof before === 'string' && LEGACY_TYPE_MAP[before] === after) return `edge type renamed ${before} → ${after} (docs/EDGE_TYPES.md)`
  if (key === 'match_status' && typeof before === 'string' && LEGACY_STATUS.has(before) && after === 'review') return `match_status ${before} → review`
  if (RENAMED_KEYS[key] && after === undefined) return `column renamed ${key} → ${RENAMED_KEYS[key]}`
  if (Object.values(RENAMED_KEYS).includes(key) && before === undefined) return `column introduced by rename (${key})`
  if (typeof before === 'number' && typeof after === 'number' && Math.abs(before - after) < 1e-6) return 'float rounding'
  return null
}

export function diffValues(entity: string, endpoint: string, path: string, a: unknown, b: unknown, out: Diff[]): void {
  if (JSON.stringify(a) === JSON.stringify(b)) return
  const bothObj = a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)
  if (bothObj) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)])
    for (const k of keys) diffValues(entity, endpoint, path ? `${path}.${k}` : k, (a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], out)
    return
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push({ entity, endpoint, path: `${path}.length`, before: a.length, after: b.length, explained: null })
    const n = Math.min(a.length, b.length)
    for (let i = 0; i < n; i++) diffValues(entity, endpoint, `${path}[${i}]`, a[i], b[i], out)
    return
  }
  out.push({ entity, endpoint, path, before: a, after: b, explained: explain(path, a, b) })
}

export function diffSnapshots(before: { entities: Record<string, Record<string, unknown>> }, after: { entities: Record<string, Record<string, unknown>> }): Diff[] {
  const out: Diff[] = []
  for (const id of new Set([...Object.keys(before.entities), ...Object.keys(after.entities)])) {
    const b = before.entities[id] ?? {}, a = after.entities[id] ?? {}
    for (const ep of new Set([...Object.keys(b), ...Object.keys(a)])) diffValues(id, ep, '', b[ep], a[ep], out)
  }
  return out
}

function main() {
  const [beforePath, afterPath] = process.argv.slice(2).filter(a => !a.startsWith('--'))
  if (!beforePath || !afterPath) { console.error('usage: parity-diff.ts before.json after.json [--json]'); process.exit(2) }
  const diffs = diffSnapshots(JSON.parse(readFileSync(beforePath, 'utf8')), JSON.parse(readFileSync(afterPath, 'utf8')))
  const unexplained = diffs.filter(d => !d.explained)
  if (process.argv.includes('--json')) console.log(JSON.stringify({ total: diffs.length, unexplained: unexplained.length, diffs }, null, 2))
  else {
    for (const d of diffs) console.log(`${d.explained ? 'ok  ' : 'DIFF'} ${d.entity} ${d.endpoint} ${d.path}: ${JSON.stringify(d.before)} → ${JSON.stringify(d.after)}${d.explained ? `  (${d.explained})` : ''}`)
    console.log(`\n${diffs.length} difference(s), ${unexplained.length} unexplained`)
  }
  process.exit(unexplained.length ? 1 : 0)
}

if (process.argv[1]?.endsWith('parity-diff.ts')) main()
