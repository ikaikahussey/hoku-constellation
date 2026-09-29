import Link from 'next/link'
import { requireWorkspace, logUsage, USAGE } from '@/lib/workspace'
import { watchedBills, sortBills, hst, recentAlerts, onboarding, entityHref } from '@/lib/workspace-queries'
import { EVENT_LABELS, type AlertEventType } from '@/lib/alerts/events'
import { dismissOnboardingAction } from './actions'
import { Badge } from '@/components/ui/Badge'

export const metadata = { title: 'Overview' }

interface Props { searchParams: Promise<{ sort?: string }> }

export default async function WorkspaceHome({ searchParams }: Props) {
  const ws = await requireWorkspace('/workspace')
  const { sort = 'hearing' } = await searchParams
  const now = new Date()
  const [bills, alerts, steps] = await Promise.all([watchedBills(ws.db, ws.team.id, now), recentAlerts(ws.db, ws.team.id), onboarding(ws.db, ws.team.id, ws.user.id)])
  await logUsage(ws.db, ws.team.id, ws.user.id, USAGE.LOGIN)
  const sorted = sortBills(bills, sort)
  const weekEnd = new Date(now.getTime() + 7 * 864e5)
  const thisWeek = bills.filter(b => b.nextHearing && b.nextHearing <= weekEnd).sort((a, b) => a.nextHearing!.getTime() - b.nextHearing!.getTime())
  const checklist = [
    { done: steps.client, label: 'Create a client', href: '/workspace/clients', needs: ws.features.reports },
    { done: steps.watchlist, label: 'Create a watchlist', href: '/workspace/watchlists', needs: true },
    { done: steps.bills, label: 'Add bills to a watchlist', href: '/workspace/watchlists', needs: true },
    { done: steps.slack, label: 'Connect Slack', href: '/workspace/team#slack', needs: ws.features.alerts },
    { done: steps.report, label: 'Generate your first report', href: '/workspace/reports', needs: ws.features.reports },
  ].filter(s => s.needs)
  const showChecklist = !steps.dismissed && checklist.some(s => !s.done)
  const th = (key: string, label: string) => (
    <th className="py-2 pr-3 text-left"><Link href={`/workspace?sort=${key}`} aria-current={sort === key ? 'true' : undefined} className={sort === key ? 'font-bold' : ''}>{label}</Link></th>
  )
  return (
    <div className="space-y-10">
      <header>
        <p className="text-xs uppercase tracking-wide text-muted">{ws.team.name} · {ws.features.tier} plan{ws.team.is_design_partner ? ' · design partner' : ''}</p>
        <h1 className="text-3xl font-bold">Overview</h1>
      </header>

      {showChecklist && (
        <section aria-labelledby="onboarding" className="border border-ink p-5">
          <h2 id="onboarding" className="text-lg font-bold mb-3">Get set up</h2>
          <ol className="space-y-2">
            {checklist.map(s => (
              <li key={s.label} className="flex items-center gap-3">
                <span aria-hidden="true" className="inline-block w-5 text-center">{s.done ? '✓' : '○'}</span>
                {s.done ? <span className="text-muted line-through">{s.label}</span> : <Link href={s.href}>{s.label}</Link>}
                <span className="sr-only">{s.done ? '(done)' : '(to do)'}</span>
              </li>
            ))}
          </ol>
          <form action={dismissOnboardingAction} className="mt-3"><button type="submit" className="text-sm underline">Hide checklist</button></form>
        </section>
      )}

      <section aria-labelledby="hearings">
        <h2 id="hearings" className="text-xl font-bold mb-3">Hearings this week</h2>
        {thisWeek.length ? (
          <ul className="divide-y divide-rule border-y border-rule">
            {thisWeek.map(b => (
              <li key={b.id} className="py-2 flex flex-wrap justify-between gap-2">
                <span><Link href={`/bills/${b.id}`} className="font-bold">{b.measure ?? b.name}</Link> <span className="text-muted">{b.title}</span></span>
                <span className="text-sm tabular">Hearing {hst(b.nextHearing!)} · testimony due {hst(b.testimonyDue!)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">No hearings scheduled in the next seven days for watched bills.</p>}
      </section>

      <section aria-labelledby="bills">
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <h2 id="bills" className="text-xl font-bold">My bills <span className="text-muted font-normal text-base tabular">({bills.length})</span></h2>
          {ws.features.exports && bills.length > 0 && <a href={`/api/export/bills?sort=${sort}`} className="text-sm">Export CSV</a>}
        </div>
        {bills.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-ink"><tr>{th('measure', 'Bill')}{th('status', 'Status')}{th('hearing', 'Next hearing')}{th('deadline', 'Next deadline')}<th className="py-2 text-left">Position</th></tr></thead>
              <tbody>
                {sorted.map(b => (
                  <tr key={b.id} className="border-b border-rule align-top">
                    <td className="py-2 pr-3"><Link href={`/bills/${b.id}`} className="font-bold">{b.measure ?? b.name}</Link><div className="text-xs text-muted">{b.title}</div></td>
                    <td className="py-2 pr-3 max-w-md">{b.status ?? '—'}{b.referral && <div className="text-xs text-muted">Referral: {b.referral}</div>}</td>
                    <td className="py-2 pr-3 tabular whitespace-nowrap">{b.nextHearing ? hst(b.nextHearing) : b.canceled ? 'Canceled' : '—'}</td>
                    <td className="py-2 pr-3 tabular whitespace-nowrap">{b.testimonyDue ? `Testimony ${hst(b.testimonyDue)}` : '—'}</td>
                    <td className="py-2">{b.position ? <Badge variant="outline">{b.position}</Badge> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted mt-2">Session deadlines (decking, crossover) will appear here once the Legislature’s session calendar is ingested.</p>
          </div>
        ) : <p className="text-sm text-muted">No bills yet. <Link href="/workspace/watchlists">Add bills to a watchlist</Link>.</p>}
      </section>

      <section aria-labelledby="alerts">
        <h2 id="alerts" className="text-xl font-bold mb-3">Recent alerts</h2>
        {alerts.length ? (
          <ul className="divide-y divide-rule border-y border-rule">
            {alerts.map(a => {
              const href = entityHref(a.entity_kind, a.entity_id, a.slug) ?? (a.document_id ? `/documents/${a.document_id}` : null)
              return (
                <li key={a.id} className="py-2">
                  <div className="text-xs text-muted uppercase tracking-wide">{EVENT_LABELS[a.event_type as AlertEventType] ?? a.event_type} · {hst(new Date(a.detected_at))}</div>
                  {href ? <Link href={href}>{a.headline}</Link> : <span>{a.headline}</span>}
                </li>
              )
            })}
          </ul>
        ) : <p className="text-sm text-muted">No alerts yet. Alerts appear here as soon as a watched item changes.</p>}
      </section>
    </div>
  )
}
