'use client'

import { useState, useEffect, useCallback } from 'react'

type Worker = {
  source: string
  label: string
  last_run_at: string | null
  status: string
  cursor_offset: number
  metadata: Record<string, unknown>
}

type WorkerStatus = {
  workers: Worker[]
  analytics: {
    scores: {
      count: number
      last_computed: string | null
      score_version: number | null
    }
    graph: {
      last_snapshot_date: string | null
      node_count: number
      edge_count: number
      cluster_count: number
    }
    alerts: {
      total: number
      pending: number
      latest_at: string | null
    }
  }
  data_volumes: {
    persons: number
    organizations: number
    relationships: number
    contributions_csc: number
    contributions_fec: number
    contributions_total: number
    lobbyist_registrations: number
    puc_dockets: number
    derived_edges: number
  }
}

const SOURCE_META: Record<string, { icon: string; cadenceHours: number }> = {
  hawaii_csc: { icon: '\u{1F3DB}', cadenceHours: 26 },
  fec: { icon: '\u{1F1FA}\u{1F1F8}', cadenceHours: 26 },
  lobbyist: { icon: '\u{1F4CB}', cadenceHours: 24 * 8 },
  puc: { icon: '\u26A1', cadenceHours: 24 * 8 },
}

function timeAgo(dateString: string | null): string {
  if (!dateString) return 'never'
  const then = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - then.getTime()
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`

  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`

  const hh = String(then.getHours()).padStart(2, '0')
  const mm = String(then.getMinutes()).padStart(2, '0')
  if (diffHr < 48) return `Yesterday at ${hh}:${mm}`

  const dateStr = then.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: then.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })
  return `${dateStr} at ${hh}:${mm}`
}

function hoursSince(dateString: string | null): number | null {
  if (!dateString) return null
  const diffMs = Date.now() - new Date(dateString).getTime()
  return diffMs / (1000 * 60 * 60)
}

function isOverdue(worker: Worker): boolean {
  const hours = hoursSince(worker.last_run_at)
  if (hours === null) return true
  const cadence = SOURCE_META[worker.source]?.cadenceHours ?? 26
  return hours > cadence
}

function StatusDot({ status, overdue }: { status: string; overdue: boolean }) {
  const { color, label } = (() => {
    if (status === 'running') return { color: 'bg-yellow-400', label: 'Running' }
    if (status === 'error') return { color: 'bg-red-500', label: 'Error' }
    if (status === 'complete') {
      if (overdue) return { color: 'bg-amber-400', label: 'Complete' }
      return { color: 'bg-green-500', label: 'Complete' }
    }
    return { color: 'bg-white/30', label: 'Idle' }
  })()

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-white/70">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  )
}

function WorkerCard({ worker }: { worker: Worker }) {
  const meta = SOURCE_META[worker.source] ?? { icon: '\u{2699}\u{FE0F}', cadenceHours: 26 }
  const overdue = isOverdue(worker)
  const lastInserted =
    typeof worker.metadata?.last_inserted === 'number'
      ? (worker.metadata.last_inserted as number)
      : null
  const error =
    typeof worker.metadata?.error === 'string' ? (worker.metadata.error as string) : null

  return (
    <div className="bg-navy-light rounded-lg border border-white/10 p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <span>{meta.icon}</span>
            {worker.label}
          </h3>
          <p className="text-xs text-white/40 mt-1 font-mono">{worker.source}</p>
        </div>
        <StatusDot status={worker.status} overdue={overdue} />
      </div>

      <div className="space-y-1.5 text-xs text-white/60">
        <p>
          Last run: <span className="text-white">{timeAgo(worker.last_run_at)}</span>
        </p>
        {lastInserted !== null && (
          <p>
            Inserted <span className="text-white">{lastInserted.toLocaleString()}</span> records
          </p>
        )}
        {worker.cursor_offset > 0 && (
          <p>
            Cursor: <span className="text-white/80">{worker.cursor_offset.toLocaleString()}</span>
          </p>
        )}
      </div>

      {error && (
        <div className="mt-3 bg-red-900/20 border border-red-500/20 rounded p-2">
          <p className="text-xs text-red-300 break-words">{error}</p>
        </div>
      )}

      {overdue && worker.status !== 'running' && (
        <div className="mt-3 bg-warning/10 border border-warning/30 rounded p-2">
          <p className="text-xs text-warning">
            Overdue &mdash; check Mac mini
          </p>
        </div>
      )}
    </div>
  )
}

function AnalyticsCard({
  title,
  children,
  warn,
}: {
  title: string
  children: React.ReactNode
  warn?: boolean
}) {
  return (
    <div
      className={`bg-navy-light rounded-lg border p-5 ${
        warn ? 'border-warning/30' : 'border-white/10'
      }`}
    >
      <h3 className="text-sm font-semibold text-white/80 mb-3">{title}</h3>
      <div className="space-y-1.5 text-xs text-white/60">{children}</div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-navy-light rounded-lg border border-white/10 p-4">
      <p className="text-2xl font-bold text-gold">{value.toLocaleString()}</p>
      <p className="text-sm text-white/50">{label}</p>
    </div>
  )
}

export default function WorkerStatusPage() {
  const [data, setData] = useState<WorkerStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/worker-status', { cache: 'no-store' })
      if (!res.ok) {
        setError(`Request failed: ${res.status}`)
        return
      }
      const json = (await res.json()) as WorkerStatus
      setData(json)
      setLastChecked(new Date())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const id = setInterval(fetchStatus, 60_000)
    return () => clearInterval(id)
  }, [fetchStatus])

  const scoresWarn =
    data !== null &&
    (data.analytics.scores.last_computed === null ||
      (hoursSince(data.analytics.scores.last_computed) ?? 0) > 26)

  const graphWarn = (() => {
    if (!data) return false
    const snap = data.analytics.graph.last_snapshot_date
    if (!snap) return true
    const snapDate = new Date(`${snap}T00:00:00`)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const diffDays = Math.floor(
      (today.getTime() - snapDate.getTime()) / (1000 * 60 * 60 * 24)
    )
    return diffDays > 1
  })()

  return (
    <div>
      <div className="flex items-start justify-between mb-6 flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-white">Pipeline Status</h1>
          <p className="text-sm text-white/50 mt-1">
            Mac mini workers &middot; Last checked:{' '}
            {lastChecked ? lastChecked.toLocaleTimeString() : '\u2014'}
          </p>
        </div>
        <button
          onClick={fetchStatus}
          className="bg-gold/10 text-gold hover:bg-gold/20 px-4 py-2 rounded text-sm font-medium transition-colors"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-500/20 rounded-lg p-4 mb-6">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {loading && !data && (
        <p className="text-sm text-white/40">Loading pipeline status&hellip;</p>
      )}

      {data && (
        <>
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-white mb-4">Workers</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {data.workers.map((w) => (
                <WorkerCard key={w.source} worker={w} />
              ))}
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-semibold text-white mb-4">Analytics Pipeline</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <AnalyticsCard title="Influence Scores" warn={scoresWarn}>
                <p>
                  <span className="text-white font-medium">
                    {data.analytics.scores.count.toLocaleString()}
                  </span>{' '}
                  persons scored
                </p>
                <p>
                  Last computed:{' '}
                  <span className="text-white">
                    {timeAgo(data.analytics.scores.last_computed)}
                  </span>
                </p>
                <p>
                  Version:{' '}
                  <span className="text-white">
                    {data.analytics.scores.score_version ?? '\u2014'}
                  </span>
                </p>
                {scoresWarn && (
                  <p className="text-warning pt-1">
                    Overdue &mdash; check Mac mini
                  </p>
                )}
              </AnalyticsCard>

              <AnalyticsCard title="Network Graph" warn={graphWarn}>
                <p>
                  <span className="text-white font-medium">
                    {data.analytics.graph.node_count.toLocaleString()}
                  </span>{' '}
                  nodes &middot;{' '}
                  <span className="text-white font-medium">
                    {data.analytics.graph.edge_count.toLocaleString()}
                  </span>{' '}
                  edges
                </p>
                <p>
                  <span className="text-white">
                    {data.analytics.graph.cluster_count.toLocaleString()}
                  </span>{' '}
                  communities
                </p>
                <p>
                  Snapshot:{' '}
                  <span className="text-white">
                    {data.analytics.graph.last_snapshot_date ?? '\u2014'}
                  </span>
                </p>
                {graphWarn && (
                  <p className="text-warning pt-1">
                    Stale snapshot &mdash; check Mac mini
                  </p>
                )}
              </AnalyticsCard>

              <AnalyticsCard title="Alerts">
                <p>
                  <span
                    className={`font-medium ${
                      data.analytics.alerts.pending > 0 ? 'text-gold' : 'text-white'
                    }`}
                  >
                    {data.analytics.alerts.pending.toLocaleString()}
                  </span>{' '}
                  pending
                </p>
                <p>
                  <span className="text-white">
                    {data.analytics.alerts.total.toLocaleString()}
                  </span>{' '}
                  total
                </p>
                <p>
                  Latest:{' '}
                  <span className="text-white">
                    {timeAgo(data.analytics.alerts.latest_at)}
                  </span>
                </p>
              </AnalyticsCard>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-semibold text-white mb-4">Data Volumes</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <StatCard label="Persons" value={data.data_volumes.persons} />
              <StatCard label="Organizations" value={data.data_volumes.organizations} />
              <StatCard label="Relationships" value={data.data_volumes.relationships} />
              <StatCard label="CSC Contributions" value={data.data_volumes.contributions_csc} />
              <StatCard label="FEC Contributions" value={data.data_volumes.contributions_fec} />
              <StatCard label="Total Contributions" value={data.data_volumes.contributions_total} />
              <StatCard
                label="Lobbyist Registrations"
                value={data.data_volumes.lobbyist_registrations}
              />
              <StatCard label="PUC Dockets" value={data.data_volumes.puc_dockets} />
              <StatCard label="Derived Edges" value={data.data_volumes.derived_edges} />
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-4">Activity Timeline</h2>
            <div className="bg-navy-light rounded-lg border border-white/10 p-5">
              <p className="text-xs text-white/40 mb-4">
                Current state of each worker. Historical run logs are not yet tracked.
              </p>
              <ol className="space-y-3">
                {data.workers
                  .slice()
                  .sort((a, b) => {
                    const at = a.last_run_at ? new Date(a.last_run_at).getTime() : 0
                    const bt = b.last_run_at ? new Date(b.last_run_at).getTime() : 0
                    return bt - at
                  })
                  .map((w) => {
                    const overdue = isOverdue(w)
                    return (
                      <li
                        key={w.source}
                        className="flex items-start gap-3 border-l-2 border-white/10 pl-4 py-1"
                      >
                        <div className="flex-1 flex items-center justify-between flex-wrap gap-2">
                          <div>
                            <p className="text-sm text-white">{w.label}</p>
                            <p className="text-xs text-white/40 font-mono">{w.source}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-white/60">{timeAgo(w.last_run_at)}</p>
                            <StatusDot status={w.status} overdue={overdue} />
                          </div>
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
