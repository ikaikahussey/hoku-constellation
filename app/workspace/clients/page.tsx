import Link from 'next/link'
import { requireWorkspace } from '@/lib/workspace'
import { ActionForm } from '@/components/workspace/ActionForm'
import { EntityPicker } from '@/components/workspace/EntityPicker'
import { UpgradeNotice } from '@/components/workspace/Upgrade'
import { inputClass } from '@/components/ui/Input'
import { deleteClientAction, saveClientAction } from '../actions'

export const metadata = { title: 'Clients' }

export default async function ClientsPage() {
  const ws = await requireWorkspace('/workspace/clients')
  if (!ws.features.reports) return <UpgradeNotice feature="Client management" tier={ws.features.tier} />
  const clients = await ws.db.many<{ id: string; name: string; report_recipients: string[]; auto_draft: boolean; entity_name: string | null; watchlists: string | null; reports: number }>(
    `select c.id, c.name, c.report_recipients, c.auto_draft, e.name entity_name,
            (select string_agg(w.name, ', ') from app.watchlist w where w.client_id = c.id) watchlists,
            (select count(*)::int from app.report r where r.client_id = c.id) reports
       from app.client c left join entity e on e.id = c.entity_id where c.team_id = $1 order by c.name`, [ws.team.id])
  return (
    <div className="space-y-8">
      <header><h1 className="text-3xl font-bold">Clients</h1><p className="text-sm text-muted mt-1">Assign watchlists to a client from the <Link href="/workspace/watchlists">watchlists</Link> page; reports cover everything on the client’s watchlists.</p></header>
      <section className="border border-rule p-5">
        <h2 className="text-lg font-bold mb-3">New client</h2>
        <ClientForm />
      </section>
      {clients.map(c => (
        <section key={c.id} className="border border-ink p-5">
          <div className="flex flex-wrap justify-between gap-3 mb-3">
            <h2 className="text-xl font-bold">{c.name}</h2>
            <span className="text-sm flex gap-4"><Link href={`/workspace/reports?client=${c.id}`}>{c.reports} report{c.reports === 1 ? '' : 's'}</Link>
              <form action={deleteClientAction}><input type="hidden" name="client_id" value={c.id} /><button type="submit" className="underline">Delete</button></form></span>
          </div>
          <p className="text-sm text-muted mb-3">Watchlists: {c.watchlists ?? 'none assigned'}{c.entity_name ? ` · Linked record: ${c.entity_name}` : ''}</p>
          <ClientForm client={c} />
        </section>
      ))}
    </div>
  )
}

function ClientForm({ client }: { client?: { id: string; name: string; report_recipients: string[]; auto_draft: boolean } }) {
  const p = client?.id ?? 'new'
  return (
    <ActionForm action={saveClientAction} submit={client ? 'Save client' : 'Add client'} variant={client ? 'secondary' : 'primary'}>
      {client && <input type="hidden" name="client_id" value={client.id} />}
      <div className="grid sm:grid-cols-2 gap-3">
        <div><label htmlFor={`cn-${p}`} className="block text-sm font-bold mb-1">Name</label><input id={`cn-${p}`} name="name" required defaultValue={client?.name} className={inputClass} /></div>
        <div><label htmlFor={`cr-${p}`} className="block text-sm font-bold mb-1">Report recipients</label><input id={`cr-${p}`} name="recipients" defaultValue={client?.report_recipients.join(', ')} className={inputClass} placeholder="name@client.org, other@client.org" /></div>
        <EntityPicker name="entity_id" kind="organization" label="Linked organization record (optional)" placeholder="Search organizations" />
        <label className="flex items-center gap-2 text-sm mt-6"><input type="checkbox" name="auto_draft" defaultChecked={client?.auto_draft} /> Draft a report every Monday (never sent automatically)</label>
      </div>
    </ActionForm>
  )
}
