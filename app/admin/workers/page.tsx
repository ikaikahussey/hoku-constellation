'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Cadence, SourceStatus } from '@/lib/import/source-registry'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { StatCard } from '@/components/admin/StatCard'
import { CADENCE_HOURS, isOverdue } from '@/components/admin/cadence'
import { formatNumber, hoursSince, humanize, timeAgo } from '@/components/admin/format'

type Worker = {
  source: string
  label: string
  agency: string
  jurisdiction: string
  tier: 1 | 2 | 3
  cadence: Cadence
  registry_status: SourceStatus
  notes: string | null
  last_run_at: string | null
  status: string
  cursor_offset: number
  metadata: Record<string, unknown>
  documents: number
  last_document_at: string | null
  edges: number
  unmatched: number
  review: number
}

type WorkerStatus = {
  workers: Worker[]
  analytics: {
    scores: { count: number; last_computed: string | null; score_version: number | null }
    graph: { last_snapshot_date: string | null; node_count: number; edge_count: number; cluster_count: number }
    alerts: { total: number; pending: number; latest_at: string | null }
  }
  data_volumes: {
    persons: number; organizations: number; bills: number; dockets: number; parcels: number
    documents: number; edges: number; derived_edges: number; unmatched_edges: number
  }
}

function stateLabel(w: Worker, overdue: boolean): { text: string; strong: boolean } {
  if (w.status === 'running') return { text: '● Running', strong: false }
  if (w.status === 'error') return { text: '⚠ Error', strong: true }
  if (overdue) return { text: '⚠ Overdue', strong: true }
  if (w.status === 'complete') return { text: '● Complete', strong: false }
  return { text: `○ ${humanize(w.status) || 'Idle'}`, strong: false }
}

function WorkerCard({ w }: { w: Worker }) {
  const overdue = w.registry_status === 'live' && isOverdue(w.cadence, w.last_run_at)
  const state = stateLabel(w, overdue)
  const lastInserted = typeof w.metadata?.last_inserted === 'number' ? w.metadata.last_inserted : null
  const error = typeof w.metadata?.error === 'string' ? w.metadata.error : null
  const limit = CADENCE_HOURS[w.cadence]

  return (
    <div className={`card bg-paper border p-5 ${state.strong ? 'border-ink' : 'border-rule'}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold leading-snug">{w.label}</h3>
          <p className="text-xs text-muted font-mono mt-1">{w.source}</p>
          <p className="text-xs text-muted mt-0.5">{w.agency} · {w.jurisdiction} · tier {w.tier}</p>
        </div>
        <Badge variant={w.registry_status === 'live' ? 'solid' : 'muted'}>{w.registry_status}</Badge>
      </div>

      <p className={`text-xs mb-2 ${state.strong ? 'font-bold' : ''}`}>{state.text}</p>

      <dl className="text-xs space-y-1 tabular">
        <div className="flex justify-between gap-2"><dt className="text-muted">Last run</dt><dd>{timeAgo(w.last_run_at)}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-muted">Cadence</dt><dd>{humanize(w.cadence)}{limit !== null ? ` (${limit}h limit)` : ''}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-muted">Cursor</dt><dd>{formatNumber(w.cursor_offset)}</dd></div>
        {lastInserted !== null && <div className="flex justify-between gap-2"><dt className="text-muted">Last inserted</dt><dd>{formatNumber(lastInserted)}</dd></div>}
        <div className="flex justify-between gap-2"><dt className="text-muted">Documents</dt><dd>{formatNumber(w.documents)}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-muted">Newest document</dt><dd>{timeAgo(w.last_document_at)}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-muted">Edges</dt><dd>{formatNumber(w.edges)}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-muted">Review / unmatched</dt><dd>{formatNumber(w.review)} / {formatNumber(w.unmatched)}</dd></div>
      </dl>

      {error && <p className="mt-3 border border-ink p-2 text-xs break-words" role="alert">⚠ {error}</p>}
      {overdue && w.status !== 'running' && !error && <p className="mt-3 text-xs font-bold">⚠ Overdue — check the worker host.</p>}
    </div>
  )
}

function AnalyticsCard({ title, warn, children }: { title: string; warn?: boolean; children: React.ReactNode }) {
  return (
    <div className={`card bg-paper border p-5 ${warn ? 'border-ink' : 'border-rule'}`}>
      <h3 className="text-sm font-bold mb-3">{title}</h3>
      <div className="space-y-1 text-xs tabular">{children}</div>
    </div>
  )
}

export default function WorkerStatusPage() {
  const [data, setData] = useState<WorkerStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/worker-status', { cache: 'no-store' })
      if (!res.ok) { setError(`Request failed: ${res.status}`); return }
      setData((await res.json()) as WorkerStatus)
      setLastChecked(new Date())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Initial load runs on the next tick so the effect body itself sets no state.
    const first = setTimeout(fetchStatus, 0)
    const id = setInterval(fetchStatus, 60_000)
    return () => { clearTimeout(first); clearInterval(id) }
  }, [fetchStatus])

  const scoresWarn = data !== null && (data.analytics.scores.last_computed === null || (hoursSince(data.analytics.scores.last_computed) ?? 0) > 26)
  const graphWarn = (() => {
    if (!data) return false
    const snap = data.analytics.graph.last_snapshot_date
    if (!snap) return true
    const snapDate = new Date(`${snap}T00:00:00`)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    return Math.floor((today.getTime() - snapDate.getTime()) / (1000 * 60 * 60 * 24)) > 1
  })()

  const workers = data?.workers ?? []
  const live = workers.filter(w => w.registry_status === 'live')
  const shown = showAll ? workers : live
  const overdueCount = live.filter(w => isOverdue(w.cadence, w.last_run_at)).length
  const errorCount = live.filter(w => w.status === 'error').length

  return (
    <div>
      <div className="flex items-start justify-between mb-6 flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Pipeline status</h1>
          <p className="text-sm text-muted mt-1">Refreshes every minute · Last checked: {lastChecked ? lastChecked.toLocaleTimeString() : '—'}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={fetchStatus}>Refresh</Button>
      </div>

      {error && <p className="border border-ink p-4 mb-6 text-sm" role="alert">⚠ {error}</p>}
      {loading && !data && <p className="text-sm text-muted">Loading pipeline status…</p>}

      {data && (
        <>
          <section className="mb-8">
            <div className="flex items-baseline justify-between gap-4 flex-wrap mb-4">
              <h2 className="text-lg font-bold">
                Workers <span className="text-sm font-normal text-muted">{live.length} live · {errorCount} failing · {overdueCount} overdue</span>
              </h2>
              <label className="text-sm flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} className="h-4 w-4 border border-ink accent-ink" />
                Show planned, blocked and manual sources ({workers.length - live.length})
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {shown.map(w => <WorkerCard key={w.source} w={w} />)}
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-bold mb-4">Analytics pipeline</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <AnalyticsCard title="Influence scores" warn={scoresWarn}>
                <p><span className="font-bold">{formatNumber(data.analytics.scores.count)}</span> entities scored</p>
                <p>Last computed: {timeAgo(data.analytics.scores.last_computed)}</p>
                <p>Version: {data.analytics.scores.score_version ?? '—'}</p>
                {scoresWarn && <p className="font-bold pt-1">⚠ Overdue — recompute has not run in 26h.</p>}
              </AnalyticsCard>
              <AnalyticsCard title="Network graph" warn={graphWarn}>
                <p><span className="font-bold">{formatNumber(data.analytics.graph.node_count)}</span> nodes · <span className="font-bold">{formatNumber(data.analytics.graph.edge_count)}</span> edges</p>
                <p>{formatNumber(data.analytics.graph.cluster_count)} communities</p>
                <p>Snapshot: {data.analytics.graph.last_snapshot_date ?? '—'}</p>
                {graphWarn && <p className="font-bold pt-1">⚠ Stale snapshot — rebuild has not run since yesterday.</p>}
              </AnalyticsCard>
              <AnalyticsCard title="Alerts">
                <p><span className="font-bold">{formatNumber(data.analytics.alerts.pending)}</span> pending</p>
                <p>{formatNumber(data.analytics.alerts.total)} total</p>
                <p>Latest: {timeAgo(data.analytics.alerts.latest_at)}</p>
              </AnalyticsCard>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-bold mb-4">Data volumes</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <StatCard label="Persons" value={data.data_volumes.persons} />
              <StatCard label="Organizations" value={data.data_volumes.organizations} />
              <StatCard label="Bills" value={data.data_volumes.bills} />
              <StatCard label="Dockets" value={data.data_volumes.dockets} />
              <StatCard label="Parcels" value={data.data_volumes.parcels} />
              <StatCard label="Documents" value={data.data_volumes.documents} />
              <StatCard label="Edges" value={data.data_volumes.edges} />
              <StatCard label="Derived edges" value={data.data_volumes.derived_edges} />
              <StatCard label="Unmatched or review edges" value={data.data_volumes.unmatched_edges} href="/admin/match-review" />
            </div>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-4">Recent runs</h2>
            <div className="card bg-paper border border-rule p-5">
              <p className="text-xs text-muted mb-4">Current state of each live worker, most recent first. Historical run logs are not yet tracked.</p>
              <ol className="divide-y divide-rule">
                {live.slice().sort((a, b) => (b.last_run_at ? new Date(b.last_run_at).getTime() : 0) - (a.last_run_at ? new Date(a.last_run_at).getTime() : 0)).map(w => {
                  const state = stateLabel(w, isOverdue(w.cadence, w.last_run_at))
                  return (
                    <li key={w.source} className="flex items-center justify-between gap-4 py-2 flex-wrap">
                      <div>
                        <p className="text-sm">{w.label}</p>
                        <p className="text-xs text-muted font-mono">{w.source}</p>
                      </div>
                      <div className="text-right text-xs tabular">
                        <p className="text-muted">{timeAgo(w.last_run_at)}</p>
                        <p className={state.strong ? 'font-bold' : ''}>{state.text}</p>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
