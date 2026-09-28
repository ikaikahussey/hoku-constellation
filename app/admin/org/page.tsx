import Link from 'next/link'
import { getServiceDb } from '@/lib/db/service'
import { listEntities } from '@/lib/db/queries'
import Pagination from '@/components/admin/Pagination'
import { formatDate, humanize } from '@/components/admin/format'
import { buttonClass } from '@/components/ui/Button'
import { inputClass } from '@/components/ui/Input'

export const dynamic = 'force-dynamic'

function str(v: unknown): string { return typeof v === 'string' ? v : '' }

export default async function AdminOrgList({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const params = await searchParams
  const query = params.q?.trim() || ''
  const page = Math.max(1, parseInt(params.page || '1', 10) || 1)
  const perPage = 25
  const offset = (page - 1) * perPage

  const db = await getServiceDb()
  const { rows, total } = await listEntities(db, { kind: 'org', q: query || undefined, limit: perPage, offset, orderBy: 'updated_at' })
  const totalPages = Math.max(1, Math.ceil(total / perPage))

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold">Organizations</h1>
        <Link href="/admin/org/new" className={buttonClass('primary', 'md')}>+ Add organization</Link>
      </div>

      <form className="mb-6 flex gap-2 max-w-md" role="search">
        <input type="search" name="q" defaultValue={query} placeholder="Search organizations by name or alias…" aria-label="Search organizations" className={inputClass} />
        <button type="submit" className={buttonClass('secondary', 'md')}>Search</button>
      </form>

      <div className="overflow-x-auto border border-rule">
        <table className="w-full text-sm tabular">
          <thead>
            <tr className="border-b border-ink">
              <th scope="col" className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wide">Name</th>
              <th scope="col" className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wide">Type</th>
              <th scope="col" className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wide">Sector</th>
              <th scope="col" className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wide">Island</th>
              <th scope="col" className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wide">Identifiers</th>
              <th scope="col" className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wide">Status</th>
              <th scope="col" className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wide">Updated</th>
              <th scope="col" className="py-2 px-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? rows.map(o => {
              const a = o.attributes
              const idKeys = Object.keys(o.identifiers ?? {})
              return (
                <tr key={o.id} className="border-b border-rule">
                  <td className="py-2 px-3 font-bold"><Link href={`/admin/entity/${o.id}`}>{o.name}</Link></td>
                  <td className="py-2 px-3">{str(a.org_type) ? <span className="border border-rule px-2 py-0.5 text-xs">{humanize(str(a.org_type))}</span> : <span className="text-muted">—</span>}</td>
                  <td className="py-2 px-3 text-muted">{humanize(str(a.sector)) || '—'}</td>
                  <td className="py-2 px-3 text-muted">{str(a.island) || '—'}</td>
                  <td className="py-2 px-3 text-xs font-mono text-muted">{idKeys.length ? idKeys.join(', ') : '—'}</td>
                  <td className={`py-2 px-3 text-xs ${str(a.status) === 'active' ? 'font-bold' : 'text-muted'}`}>{str(a.status) || '—'}</td>
                  <td className="py-2 px-3 text-xs text-muted whitespace-nowrap">{formatDate(o.updated_at)}</td>
                  <td className="py-2 px-3 text-right"><Link href={`/admin/org/${o.id}/edit`} className="text-sm">Edit</Link></td>
                </tr>
              )
            }) : (
              <tr><td colSpan={8} className="py-12 text-center text-muted">{query ? 'No organizations match your search.' : 'No organizations yet. Add one to get started.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination currentPage={page} totalPages={totalPages} totalCount={total} perPage={perPage} basePath="/admin/org" searchParams={{ q: query || undefined }} />
    </div>
  )
}
