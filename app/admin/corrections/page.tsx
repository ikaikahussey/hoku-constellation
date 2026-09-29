import type { Metadata } from 'next'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { getServiceDb } from '@/lib/db/service'
import { getCurrentUser } from '@/lib/auth'
import { listCorrections, oneBusinessDayAfter, updateCorrection } from '@/lib/corrections'
import { Badge } from '@/components/ui/Badge'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Corrections — Admin' }

async function act(fd: FormData) {
  'use server'
  const user = await getCurrentUser()
  if (!user?.isStaff) return
  await updateCorrection(await getServiceDb(), String(fd.get('id')), user.id, String(fd.get('action')) as 'acknowledge' | 'resolve' | 'reject', String(fd.get('resolution') ?? ''))
  revalidatePath('/admin/corrections')
}

export default async function CorrectionsQueue({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { all } = await searchParams
  const rows = await listCorrections(await getServiceDb(), all ? 'all' : 'open')
  const overdue = rows.filter(r => r.overdue).length
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap justify-between gap-3">
        <div><h1 className="text-2xl font-bold">Corrections</h1>
          <p className="text-sm text-muted">Target: acknowledge within 1 business day (HST). {overdue ? <strong>⚠ {overdue} overdue.</strong> : 'None overdue.'}</p></div>
        <Link href={all ? '/admin/corrections' : '/admin/corrections?all=1'} className="text-sm">{all ? 'Open only' : 'Show all'}</Link>
      </header>
      {!rows.length && <p className="text-muted">No open corrections.</p>}
      {rows.map(r => {
        const target = r.entity_id ? { href: r.entity_kind === 'bill' ? `/bills/${r.entity_id}` : r.slug ? `/${r.entity_kind === 'org' ? 'org' : 'person'}/${r.slug}` : `/admin/entity/${r.entity_id}`, label: r.entity_name }
          : r.document_id ? { href: `/documents/${r.document_id}`, label: r.document_title ?? 'Document' } : r.page_url ? { href: r.page_url, label: r.page_url } : null
        return (
          <article key={r.id} className={`border p-4 space-y-2 ${r.overdue ? 'border-ink border-2' : 'border-rule'}`}>
            <div className="flex flex-wrap gap-2 items-center text-sm">
              <Badge variant={r.status === 'open' ? 'solid' : 'outline'}>{r.status}</Badge>
              {r.overdue && <Badge variant="outline">overdue</Badge>}
              <span className="text-muted tabular">filed {r.created_at.slice(0, 16)} · due {oneBusinessDayAfter(new Date(r.created_at)).toISOString().slice(0, 16)}</span>
              {r.reporter_email && <span className="text-muted" data-ph-mask>· {r.reporter_email}</span>}
            </div>
            {target && <p className="text-sm">About: <Link href={target.href}>{target.label}</Link></p>}
            <p className="whitespace-pre-wrap">{r.description}</p>
            {r.resolution && <p className="text-sm border-l-2 border-ink pl-3">Resolution: {r.resolution}</p>}
            {(r.status === 'open' || r.status === 'acknowledged') && (
              <form action={act} className="flex flex-wrap gap-2 items-end">
                <input type="hidden" name="id" value={r.id} />
                <label className="flex-1 min-w-64 text-sm"><span className="sr-only">Resolution</span><input name="resolution" placeholder="Resolution (what changed, or why no change)" className="w-full border border-rule px-2 py-1" /></label>
                {r.status === 'open' && <button name="action" value="acknowledge" className="border border-ink px-3 py-1 text-sm">Acknowledge</button>}
                <button name="action" value="resolve" className="border border-ink px-3 py-1 text-sm bg-ink text-paper">Resolve</button>
                <button name="action" value="reject" className="border border-ink px-3 py-1 text-sm">Reject</button>
              </form>
            )}
          </article>
        )
      })}
    </div>
  )
}
