import type { Metadata } from 'next'
import { revalidatePath } from 'next/cache'
import { getServiceDb } from '@/lib/db/service'
import { getCurrentUser } from '@/lib/auth'
import { partnerUsage } from '@/lib/ops/partners'
import { Badge } from '@/components/ui/Badge'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Design partners — Admin' }

async function setPartner(fd: FormData) {
  'use server'
  const user = await getCurrentUser()
  if (!user?.isStaff) return
  const on = fd.get('on') === '1'
  await (await getServiceDb()).query(`update app.team set is_design_partner = $2, coupon_code = case when $2 then 'design_partner' else coupon_code end where id = $1`, [String(fd.get('team_id')), on])
  revalidatePath('/admin/partners')
}

export default async function PartnersPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const days = Math.min(90, Math.max(1, Number((await searchParams).days ?? 7)))
  const rows = await partnerUsage(await getServiceDb(), { days })
  const cols: Array<[keyof (typeof rows)[number], string]> = [
    ['seats_active', 'Seats active'], ['active_days_per_seat', 'Active days / seat'], ['alerts_delivered', 'Alerts delivered'], ['alerts_opened', 'Alerts opened'],
    ['reports_generated', 'Reports generated'], ['reports_sent', 'Reports sent'], ['briefings_viewed', 'Briefings viewed'], ['questions', 'Q&A questions'],
  ]
  return (
    <div className="space-y-6">
      <header><h1 className="text-2xl font-bold">Design partners</h1>
        <p className="text-sm text-muted">Team usage over the last {days} days (<a href="?days=7">7</a> · <a href="?days=30">30</a>). The owner receives this summary by email every Monday.</p></header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-ink text-left"><tr><th className="py-2 pr-3">Team</th>{cols.map(([, l]) => <th key={l} className="py-2 pr-3 text-right">{l}</th>)}<th className="py-2 pr-3">Last login</th><th className="py-2"><span className="sr-only">Partner flag</span></th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.team_id} className="border-b border-rule">
              <td className="py-2 pr-3"><strong>{r.name}</strong> <span className="text-xs text-muted">{r.plan}</span> {r.is_design_partner && <Badge variant="solid">partner</Badge>}</td>
              {cols.map(([k]) => <td key={k} className="py-2 pr-3 text-right tabular">{k === 'seats_active' ? `${r.seats_active}/${r.seat_count}` : String(r[k])}</td>)}
              <td className="py-2 pr-3 tabular">{r.last_login?.slice(0, 10) ?? '—'}</td>
              <td className="py-2"><form action={setPartner}><input type="hidden" name="team_id" value={r.team_id} /><input type="hidden" name="on" value={r.is_design_partner ? '0' : '1'} /><button className="underline">{r.is_design_partner ? 'Remove flag' : 'Mark partner'}</button></form></td>
            </tr>))}
            {!rows.length && <tr><td colSpan={cols.length + 3} className="py-3 text-muted">No teams yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
