import type { Metadata } from 'next'
import { getServiceDb } from '@/lib/db/service'
import { alertStats } from '@/lib/alerts'
import { StatCard } from '@/components/admin/StatCard'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Alerts — Admin' }

const fmt = (s: number | null) => s == null ? '—' : s < 60 ? `${s.toFixed(1)}s` : `${(s / 60).toFixed(1)}m`

export default async function AdminAlertsPage() {
  const stats = await alertStats(await getServiceDb(), 14)
  const max = Math.max(1, ...stats.latency.histogram.map(h => h.n))
  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-bold">Alerts</h1>
        <p className="text-sm text-muted">Last 14 days. Latency is source document commit (fetched_at) to email/Slack sent. Target: p95 under 60 seconds.</p>
      </header>
      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Events" value={stats.byDay.reduce((a, d) => a + d.events, 0)} />
        <StatCard label="Delivered" value={stats.byDay.reduce((a, d) => a + d.delivered, 0)} />
        <StatCard label="Failed" value={stats.byDay.reduce((a, d) => a + d.failed, 0)} />
        <StatCard label="p50 / p95 latency" value={`${fmt(stats.latency.p50)} / ${fmt(stats.latency.p95)}`} detail={`${stats.latency.n} instant sends`} />
        <StatCard label="Pending or deferred" value={stats.pending} />
      </section>
      <section>
        <h2 className="text-lg font-bold mb-3">Latency distribution</h2>
        <table className="w-full text-sm">
          <tbody>
            {stats.latency.histogram.map(h => (
              <tr key={h.bucket} className="border-b border-rule">
                <td className="py-1 w-24 tabular">{h.bucket}</td>
                <td className="py-1"><div className="bg-ink h-3" style={{ width: `${(h.n / max) * 100}%` }} aria-hidden="true" /></td>
                <td className="py-1 w-20 text-right tabular">{h.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2 className="text-lg font-bold mb-3">Volume by day (HST)</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-ink text-left"><th className="py-1">Day</th><th className="py-1 text-right">Events</th><th className="py-1 text-right">Delivered</th><th className="py-1 text-right">Failed</th></tr></thead>
          <tbody>
            {stats.byDay.map(d => (
              <tr key={d.day} className="border-b border-rule tabular"><td className="py-1">{d.day}</td><td className="py-1 text-right">{d.events}</td><td className="py-1 text-right">{d.delivered}</td><td className="py-1 text-right">{d.failed}</td></tr>
            ))}
            {!stats.byDay.length && <tr><td colSpan={4} className="py-3 text-muted">No alert events yet.</td></tr>}
          </tbody>
        </table>
      </section>
      <section>
        <h2 className="text-lg font-bold mb-3">Delivery failures</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-ink text-left"><th className="py-1">When</th><th className="py-1">Team</th><th className="py-1">Channel</th><th className="py-1">Attempts</th><th className="py-1">Error</th></tr></thead>
          <tbody>
            {stats.failures.map(f => (
              <tr key={f.id} className="border-b border-rule"><td className="py-1 tabular">{f.created_at.slice(0, 16)}</td><td className="py-1">{f.team_name}</td><td className="py-1">{f.channel}</td><td className="py-1 tabular">{f.attempts}</td><td className="py-1 text-muted">{f.error}</td></tr>
            ))}
            {!stats.failures.length && <tr><td colSpan={5} className="py-3 text-muted">No failed deliveries.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  )
}
