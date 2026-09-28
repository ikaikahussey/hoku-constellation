import { NextResponse } from 'next/server'
import { authenticateStaff } from '@/app/api/analytics/_lib/auth'
import { SOURCE_REGISTRY } from '@/lib/import/source-registry'
import type { ImportCursorRow } from '@/lib/db/types'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

export async function GET() {
  const { error, db } = await authenticateStaff()
  if (error) return error

  const [cursors, docCounts, edgeCounts, unmatched, scores, graph, alerts, volumes] = await Promise.all([
    db.many<ImportCursorRow>(`select source, cursor_offset, last_run_at, status, metadata from import_cursor`),
    db.many<{ source: string; n: string; last: string | null }>(`select source, count(*)::text n, max(fetched_at)::text last from document group by source`),
    db.many<{ source: string; n: string; unmatched: string; review: string }>(
      `select d.source, count(*)::text n, count(*) filter (where e.match_status = 'unmatched')::text unmatched, count(*) filter (where e.match_status = 'review')::text review
         from edge e join document d on d.id = e.document_id group by d.source`),
    db.one<{ n: string }>(`select count(*)::text n from edge where match_status <> 'matched'`),
    db.one<{ n: string; last: string | null; v: number | null }>(`select count(*)::text n, max(computed_at)::text last, max(score_version) v from ax_influence_score`),
    db.one<{ snapshot_date: string; node_count: number; edge_count: number; metrics: { cluster_count?: number } }>(`select snapshot_date::text, node_count, edge_count, metrics from ax_graph_snapshot order by snapshot_date desc limit 1`),
    db.one<{ total: string; pending: string; latest: string | null }>(`select count(*)::text total, count(*) filter (where not acknowledged)::text pending, max(created_at)::text latest from ax_alert`),
    db.one<{ persons: string; orgs: string; bills: string; dockets: string; parcels: string; documents: string; edges: string; derived: string }>(
      `select (select count(*) from entity where kind='person')::text persons, (select count(*) from entity where kind='org')::text orgs,
              (select count(*) from entity where kind='bill')::text bills, (select count(*) from entity where kind='docket')::text dockets,
              (select count(*) from entity where kind='parcel')::text parcels, (select count(*) from document)::text documents,
              (select count(*) from edge)::text edges, (select count(*) from ax_relationship_edge)::text derived`),
  ])

  const cursorBySource = new Map(cursors.map(c => [c.source, c]))
  const docsBySource = new Map(docCounts.map(d => [d.source, d]))
  const edgesBySource = new Map(edgeCounts.map(e => [e.source, e]))

  const workers = SOURCE_REGISTRY.map(s => {
    const cursor = cursorBySource.get(s.key)
    const docs = docsBySource.get(s.key)
    const edges = edgesBySource.get(s.key)
    return {
      source: s.key, label: s.name, agency: s.agency, jurisdiction: s.jurisdiction, tier: s.tier, cadence: s.cadence,
      registry_status: s.status, notes: s.notes ?? null,
      last_run_at: cursor?.last_run_at ?? null,
      status: cursor?.status ?? 'idle',
      cursor_offset: cursor?.cursor_offset ?? 0,
      metadata: cursor?.metadata ?? {},
      documents: Number(docs?.n ?? 0),
      last_document_at: docs?.last ?? null,
      edges: Number(edges?.n ?? 0),
      unmatched: Number(edges?.unmatched ?? 0),
      review: Number(edges?.review ?? 0),
    }
  })

  return NextResponse.json({
    workers,
    analytics: {
      scores: { count: Number(scores?.n ?? 0), last_computed: scores?.last ?? null, score_version: scores?.v ?? null },
      graph: { last_snapshot_date: graph?.snapshot_date ?? null, node_count: graph?.node_count ?? 0, edge_count: graph?.edge_count ?? 0, cluster_count: graph?.metrics?.cluster_count ?? 0 },
      alerts: { total: Number(alerts?.total ?? 0), pending: Number(alerts?.pending ?? 0), latest_at: alerts?.latest ?? null },
    },
    data_volumes: {
      persons: Number(volumes?.persons ?? 0), organizations: Number(volumes?.orgs ?? 0), bills: Number(volumes?.bills ?? 0),
      dockets: Number(volumes?.dockets ?? 0), parcels: Number(volumes?.parcels ?? 0), documents: Number(volumes?.documents ?? 0),
      edges: Number(volumes?.edges ?? 0), derived_edges: Number(volumes?.derived ?? 0), unmatched_edges: Number(unmatched?.n ?? 0),
    },
  })
}
