import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { importCSCBatch } from '@/lib/import/sources/csc'
import { importFECFull } from '@/lib/import/sources/fec'
import { importLobbyistFull } from '@/lib/import/sources/lobbyist'
import { importPUCFull } from '@/lib/import/sources/puc'

export const maxDuration = 55

const CKAN_BASE = 'https://opendata.hawaii.gov/api/3/action'
const FEC_BASE = 'https://api.open.fec.gov/v1'
const FEC_API_KEY = process.env.FEC_API_KEY || 'DEMO_KEY'
const LOBBYIST_RESOURCE_ID = 'aed69d13-fe07-4e91-8abf-a51c8a408e1f'

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---- Preview: check source counts vs DB counts ----

async function previewCSC() {
  const searchRes = await fetch(`${CKAN_BASE}/package_search?q=campaign+contributions+received`)
  const searchData = await searchRes.json()
  let resourceId = ''
  for (const ds of searchData?.result?.results || []) {
    for (const r of ds.resources || []) {
      if (r.format === 'CSV' && (r.name || '').toLowerCase().includes('contribution')) {
        resourceId = r.id
        break
      }
    }
    if (resourceId) break
  }
  if (!resourceId) {
    const altSearch = await fetch(`${CKAN_BASE}/package_search?q=campaign+spending+commission`)
    const altData = await altSearch.json()
    for (const ds of altData?.result?.results || []) {
      for (const r of ds.resources || []) {
        if (r.datastore_active) { resourceId = r.id; break }
      }
      if (resourceId) break
    }
  }
  if (!resourceId) return { source_total: 0, db_count: 0, delta: 0 }

  const countRes = await fetch(`${CKAN_BASE}/datastore_search?resource_id=${resourceId}&limit=0`)
  const countData = await countRes.json()
  const sourceTotal = countData?.result?.total ?? 0

  const supabase = createAdminClient()
  const { count } = await supabase.from('contribution').select('*', { count: 'exact', head: true }).eq('source', 'hawaii_csc')
  return { source_total: sourceTotal, db_count: count ?? 0, delta: sourceTotal - (count ?? 0) }
}

async function previewFEC() {
  const supabase = createAdminClient()
  const { count: dbCount } = await supabase.from('contribution').select('*', { count: 'exact', head: true }).eq('source', 'fec')

  let sourceTotal = 0
  const committees = [
    { name: 'Schatz', id: 'S4HI00089' },
    { name: 'Hirono', id: 'S2HI00106' },
    { name: 'Case', id: 'H6HI02164' },
  ]
  for (const c of committees) {
    try {
      const url = `${FEC_BASE}/candidate/${c.id}/totals/?api_key=${FEC_API_KEY}`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        const totals = data.results?.[0]
        if (totals?.individual_itemized_contributions) {
          sourceTotal += Math.ceil(totals.individual_itemized_contributions / 100)
        }
      }
      await delay(500)
    } catch {
      // FEC rate limit
    }
  }

  return { source_total: sourceTotal || 'unknown (API rate limited)', db_count: dbCount ?? 0, delta: typeof sourceTotal === 'number' ? sourceTotal - (dbCount ?? 0) : 'unknown' }
}

async function previewLobbyist() {
  const countRes = await fetch(`${CKAN_BASE}/datastore_search?resource_id=${LOBBYIST_RESOURCE_ID}&limit=0`)
  const countData = await countRes.json()
  const sourceTotal = countData?.result?.total ?? 0

  const supabase = createAdminClient()
  const { count } = await supabase.from('lobbyist_registration').select('*', { count: 'exact', head: true })
  return { source_total: sourceTotal, db_count: count ?? 0, delta: sourceTotal - (count ?? 0) }
}

async function previewPUC() {
  const supabase = createAdminClient()
  const { count } = await supabase.from('puc_docket').select('*', { count: 'exact', head: true })
  return { source_total: 6, db_count: count ?? 0, delta: 6 - (count ?? 0), note: 'No public API — using curated docket list' }
}

// ---- GET: Check import status / counts + optional preview ----
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const preview = searchParams.get('preview')

  if (preview) {
    try {
      let result
      switch (preview) {
        case 'hawaii_csc': result = await previewCSC(); break
        case 'fec': result = await previewFEC(); break
        case 'lobbyist': result = await previewLobbyist(); break
        case 'puc': result = await previewPUC(); break
        default: return NextResponse.json({ error: `Unknown source: ${preview}` }, { status: 400 })
      }
      return NextResponse.json({ source: preview, ...result })
    } catch (e) {
      return NextResponse.json({ error: `Preview failed: ${e instanceof Error ? e.message : 'Unknown error'}` }, { status: 500 })
    }
  }

  const supabase = createAdminClient()
  const [contributions, lobbyist, dockets] = await Promise.all([
    supabase.from('contribution').select('source', { count: 'exact' }),
    supabase.from('lobbyist_registration').select('*', { count: 'exact', head: true }),
    supabase.from('puc_docket').select('*', { count: 'exact', head: true }),
  ])

  const contribBySource: Record<string, number> = {}
  for (const row of contributions.data || []) {
    const src = row.source || 'unknown'
    contribBySource[src] = (contribBySource[src] || 0) + 1
  }

  return NextResponse.json({
    contributions: { total: contributions.count ?? 0, by_source: contribBySource },
    lobbyist_registrations: lobbyist.count ?? 0,
    puc_dockets: dockets.count ?? 0,
  })
}

// ---- POST: Trigger an import ----
// CSC uses batched imports (offset/limit) to stay within serverless timeout.
// The UI calls repeatedly until done=true.
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { source, offset } = body as { source: string; offset?: number }

  if (!source) {
    return NextResponse.json({ error: 'source is required' }, { status: 400 })
  }

  try {
    let result
    switch (source) {
      case 'hawaii_csc': {
        const batchResult = await importCSCBatch(offset ?? 0, 1000)
        return NextResponse.json({
          success: true,
          source,
          inserted: batchResult.inserted,
          personsCreated: batchResult.personsCreated,
          nextOffset: batchResult.nextOffset,
          done: batchResult.done,
        })
      }
      case 'fec':
        result = await importFECFull()
        break
      case 'lobbyist':
        result = await importLobbyistFull()
        break
      case 'puc':
        result = await importPUCFull()
        break
      default:
        return NextResponse.json({ error: `Unknown source: ${source}` }, { status: 400 })
    }

    return NextResponse.json({ success: true, source, done: true, ...result })
  } catch (e) {
    console.error(`Import error for ${source}:`, e)
    return NextResponse.json(
      { error: `Import failed: ${e instanceof Error ? e.message : 'Unknown error'}` },
      { status: 500 }
    )
  }
}
