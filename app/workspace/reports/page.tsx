import Link from 'next/link'
import { requireWorkspace } from '@/lib/workspace'
import { lastWeek } from '@/lib/reports'
import { ActionForm } from '@/components/workspace/ActionForm'
import { UpgradeNotice } from '@/components/workspace/Upgrade'
import { Badge } from '@/components/ui/Badge'
import { inputClass } from '@/components/ui/Input'
import { generateReportAction } from '../actions'

export const metadata = { title: 'Reports' }

interface Props { searchParams: Promise<{ client?: string }> }

export default async function ReportsPage({ searchParams }: Props) {
  const ws = await requireWorkspace('/workspace/reports')
  if (!ws.features.reports) return <UpgradeNotice feature="Client reports" tier={ws.features.tier} />
  const { client } = await searchParams
  const clients = await ws.db.many<{ id: string; name: string }>(`select id, name from app.client where team_id = $1 order by name`, [ws.team.id])
  const reports = await ws.db.many<{ id: string; client: string; period_start: string; period_end: string; status: string; narrative_source: string; created_at: string; sent_at: string | null }>(
    `select r.id, c.name client, r.period_start::text, r.period_end::text, r.status, r.narrative_source, r.created_at::text, r.sent_at::text
       from app.report r join app.client c on c.id = r.client_id where r.team_id = $1 and ($2::uuid is null or r.client_id = $2) order by r.created_at desc limit 200`,
    [ws.team.id, client && /^[0-9a-f-]{36}$/.test(client) ? client : null])
  const week = lastWeek(new Date())
  return (
    <div className="space-y-8">
      <header><h1 className="text-3xl font-bold">Client reports</h1>
        <p className="text-sm text-muted mt-1">Drafts are built from the records on each client’s watchlists. Every sentence cites its source. Nothing is sent until someone on your team approves it.</p></header>
      {clients.length ? (
        <section className="border border-rule p-5">
          <h2 className="text-lg font-bold mb-3">Generate a report</h2>
          <ActionForm action={generateReportAction} submit="Generate draft">
            <div className="grid sm:grid-cols-3 gap-3">
              <div><label htmlFor="rc" className="block text-sm font-bold mb-1">Client</label><select id="rc" name="client_id" defaultValue={client} className={inputClass}>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label htmlFor="rs" className="block text-sm font-bold mb-1">From</label><input id="rs" type="date" name="start" defaultValue={week.start} required className={inputClass} /></div>
              <div><label htmlFor="re" className="block text-sm font-bold mb-1">To</label><input id="re" type="date" name="end" defaultValue={week.end} required className={inputClass} /></div>
            </div>
          </ActionForm>
        </section>
      ) : <p><Link href="/workspace/clients">Create a client</Link> to start generating reports.</p>}
      <section>
        <h2 className="text-lg font-bold mb-3">Reports</h2>
        {reports.length ? (
          <table className="w-full text-sm">
            <thead className="border-b border-ink text-left"><tr><th className="py-2">Client</th><th className="py-2">Period</th><th className="py-2">Status</th><th className="py-2">Created</th></tr></thead>
            <tbody>{reports.map(r => (
              <tr key={r.id} className="border-b border-rule">
                <td className="py-2"><Link href={`/workspace/reports/${r.id}`}>{r.client}</Link></td>
                <td className="py-2 tabular">{r.period_start} – {r.period_end}</td>
                <td className="py-2"><Badge variant={r.status === 'sent' ? 'solid' : 'outline'}>{r.status}</Badge></td>
                <td className="py-2 tabular">{r.created_at.slice(0, 10)}</td>
              </tr>))}
            </tbody>
          </table>
        ) : <p className="text-sm text-muted">No reports yet.</p>}
      </section>
    </div>
  )
}
