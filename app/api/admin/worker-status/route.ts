import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

const WORKER_SOURCES: { source: string; label: string }[] = [
  { source: 'hawaii_csc', label: 'Hawaii Campaign Spending Commission' },
  { source: 'fec', label: 'Federal Election Commission' },
  { source: 'lobbyist', label: 'Lobbyist Registrations' },
  { source: 'puc', label: 'PUC Dockets' },
]

type WorkerEntry = {
  source: string
  label: string
  last_run_at: string | null
  status: string
  cursor_offset: number
  metadata: Record<string, unknown>
}

export async function GET() {
  const supabase = createAdminClient()

  const [
    cursors,
    scoresCount,
    scoresLatest,
    graphLatest,
    alertsTotal,
    alertsPending,
    alertsLatest,
    persons,
    orgs,
    relationships,
    cscContribs,
    fecContribs,
    lobbyistRegs,
    pucDockets,
    derivedEdges,
  ] = await Promise.all([
    supabase
      .from('import_cursor')
      .select('source, cursor_offset, last_run_at, status, metadata'),
    supabase
      .from('ax_influence_score')
      .select('id', { count: 'exact', head: true }),
    supabase
      .from('ax_influence_score')
      .select('computed_at, score_version')
      .order('computed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('ax_graph_snapshot')
      .select('snapshot_date, node_count, edge_count, metrics')
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('ax_alert').select('id', { count: 'exact', head: true }),
    supabase
      .from('ax_alert')
      .select('id', { count: 'exact', head: true })
      .eq('acknowledged', false),
    supabase
      .from('ax_alert')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('person').select('id', { count: 'estimated', head: true }),
    supabase.from('organization').select('id', { count: 'estimated', head: true }),
    supabase.from('relationship').select('id', { count: 'estimated', head: true }),
    supabase
      .from('contribution')
      .select('id', { count: 'estimated', head: true })
      .eq('source', 'hawaii_csc'),
    supabase
      .from('contribution')
      .select('id', { count: 'estimated', head: true })
      .eq('source', 'fec'),
    supabase
      .from('lobbyist_registration')
      .select('id', { count: 'estimated', head: true }),
    supabase.from('puc_docket').select('id', { count: 'estimated', head: true }),
    supabase
      .from('ax_relationship_edge')
      .select('id', { count: 'estimated', head: true }),
  ])

  const cursorRows = (cursors.data ?? []) as {
    source: string
    cursor_offset: number | null
    last_run_at: string | null
    status: string | null
    metadata: Record<string, unknown> | null
  }[]
  const cursorBySource = new Map(cursorRows.map((r) => [r.source, r]))

  const workers: WorkerEntry[] = WORKER_SOURCES.map(({ source, label }) => {
    const row = cursorBySource.get(source)
    return {
      source,
      label,
      last_run_at: row?.last_run_at ?? null,
      status: row?.status ?? 'idle',
      cursor_offset: row?.cursor_offset ?? 0,
      metadata: row?.metadata ?? {},
    }
  })

  const graphMetrics = (graphLatest.data?.metrics ?? {}) as {
    cluster_count?: number
  }

  const cscTotal = cscContribs.count ?? 0
  const fecTotal = fecContribs.count ?? 0

  return NextResponse.json({
    workers,
    analytics: {
      scores: {
        count: scoresCount.count ?? 0,
        last_computed: scoresLatest.data?.computed_at ?? null,
        score_version: scoresLatest.data?.score_version ?? null,
      },
      graph: {
        last_snapshot_date: graphLatest.data?.snapshot_date ?? null,
        node_count: graphLatest.data?.node_count ?? 0,
        edge_count: graphLatest.data?.edge_count ?? 0,
        cluster_count: graphMetrics.cluster_count ?? 0,
      },
      alerts: {
        total: alertsTotal.count ?? 0,
        pending: alertsPending.count ?? 0,
        latest_at: alertsLatest.data?.created_at ?? null,
      },
    },
    data_volumes: {
      persons: persons.count ?? 0,
      organizations: orgs.count ?? 0,
      relationships: relationships.count ?? 0,
      contributions_csc: cscTotal,
      contributions_fec: fecTotal,
      contributions_total: cscTotal + fecTotal,
      lobbyist_registrations: lobbyistRegs.count ?? 0,
      puc_dockets: pucDockets.count ?? 0,
      derived_edges: derivedEdges.count ?? 0,
    },
  })
}
