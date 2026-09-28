#!/usr/bin/env -S npx tsx --tsconfig tsconfig.scripts.json
/**
 * Snapshots analytics API output for a set of entities so the legacy (Supabase) deployment and the
 * Neon preview can be compared field by field with scripts/db/parity-diff.ts.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/db/parity-snapshot.ts \
 *     --entities <id,id,…> --base https://constellation.hoku.fm --out parity/before.json [--token <session-or-api-token>]
 *
 * Endpoints captured per entity: /api/analytics/person/{id}/profile, /score, /network,
 * /api/analytics/org/{id}/profile, /api/v1/person/{id}, /api/v1/person/{id}/contributions,
 * /api/v1/person/{id}/relationships, /api/v1/org/{id}, /api/v1/org/{id}/people, /api/v1/org/{id}/contributions.
 * Non-2xx responses are recorded as { status } so a 404 on one side shows up as a difference.
 * Volatile fields (timestamps, computed_at, cache ids) are stripped before writing.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const ENDPOINTS = (id: string) => [
  `/api/analytics/person/${id}/profile`, `/api/analytics/person/${id}/score`, `/api/analytics/person/${id}/network`,
  `/api/analytics/org/${id}/profile`,
  `/api/v1/person/${id}`, `/api/v1/person/${id}/contributions`, `/api/v1/person/${id}/relationships`,
  `/api/v1/org/${id}`, `/api/v1/org/${id}/people`, `/api/v1/org/${id}/contributions`,
]
const VOLATILE = new Set(['computed_at', 'created_at', 'updated_at', 'generated_at', 'last_run_at', 'cached', 'request_id', 'snapshot_id', 'fetched_at'])

export function stripVolatile(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripVolatile)
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) if (!VOLATILE.has(k)) o[k] = stripVolatile(val)
    return o
  }
  return v
}

async function main() {
  const args = process.argv.slice(2)
  const get = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }
  const entities = (get('--entities') ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const base = (get('--base') ?? process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '')
  const out = get('--out') ?? 'parity/snapshot.json'
  const token = get('--token') ?? process.env.PARITY_TOKEN
  if (!entities.length || !base) { console.error('usage: --entities <ids> --base <url> [--out file] [--token t]'); process.exit(2) }
  const snapshot: Record<string, unknown> = { base, taken_at: new Date().toISOString(), entities: {} }
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}`, cookie: token } : {}
  for (const id of entities) {
    const per: Record<string, unknown> = {}
    for (const path of ENDPOINTS(id)) {
      try {
        const res = await fetch(`${base}${path}`, { headers })
        per[path.replace(id, '{id}')] = res.ok ? stripVolatile(await res.json()) : { status: res.status }
      } catch (e) { per[path.replace(id, '{id}')] = { error: (e as Error).message } }
    }
    ;(snapshot.entities as Record<string, unknown>)[id] = per
    console.log(`snapshotted ${id}`)
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(snapshot, null, 2))
  console.log(`wrote ${out}`)
}

if (process.argv[1]?.endsWith('parity-snapshot.ts')) main().catch(e => { console.error(e); process.exit(1) })
