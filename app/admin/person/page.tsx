import Link from 'next/link'
import { getServiceDb } from '@/lib/db/service'
import { listEntities } from '@/lib/db/queries'
import Pagination from '@/components/admin/Pagination'
import { formatDate, humanize } from '@/components/admin/format'
import { buttonClass } from '@/components/ui/Button'
import { inputClass } from '@/components/ui/Input'

export const dynamic = 'force-dynamic'

function str(v: unknown): string { return typeof v === 'string' ? v : '' }

export default async function AdminPersonList({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const params = await searchParams
  const query = params.q?.trim() || ''
  const page = Math.max(1, parseInt(params.page || '1', 10) || 1)
  const perPage = 25
  const offset = (page - 1) * perPage

  const db = await getServiceDb()
  const { rows, total } = await listEntities(db, { kind: 'person', q: query || undefined, limit: perPage, offset, orderBy: 'updated_at' })
  const totalPages = Math.max(1, Math.ceil(total / perPage))

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold">People</h1>
        <Link href="/admin/person/new" className={buttonClass('primary', 'md')}>+ Add person</Link>
      </div>

      <form className="mb-6 flex gap-2 max-w-md" role="search">
        <input type="search" name="q" defaultValue={query} placeholder="Search people by name or alias…" aria-label="Search people" className={inputClass} />
        <button type="submit" className={buttonClass('secondary', 'md')}>Search</button>
      </form>

      <div className="overflow-x-auto border border-rule">
        <table className="w-full text-sm tabular">
          <thead>
            <tr className="border-b border-ink">
              <th scope="col" className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wide">Name</th>
              <th scope="col" className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wide">Types</th>
              <th scope="col" className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wide">Office</th>
              <th scope="col" className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wide">Island</th>
              <th scope="col" className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wide">Status</th>
              <th scope="col" className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wide">Updated</th>
              <th scope="col" className="py-2 px-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? rows.map(p => {
              const a = p.attributes
              const types = Array.isArray(a.entity_types) ? (a.entity_types as string[]) : []
              return (
                <tr key={p.id} className="border-b border-rule">
                  <td className="py-2 px-3 font-bold"><Link href={`/admin/person/${p.id}`}>{p.name}</Link></td>
                  <td className="py-2 px-3">
                    <span className="flex flex-wrap gap-1">
                      {types.slice(0, 2).map(t => <span key={t} className="border border-rule px-2 py-0.5 text-xs">{humanize(t)}</span>)}
                      {types.length > 2 && <span className="text-xs text-muted">+{types.length - 2}</span>}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-muted">{str(a.office_held) || '—'}</td>
                  <td className="py-2 px-3 text-muted">{str(a.island) || '—'}</td>
                  <td className={`py-2 px-3 text-xs ${str(a.status) === 'active' ? 'font-bold' : 'text-muted'}`}>{str(a.status) || '—'}</td>
                  <td className="py-2 px-3 text-xs text-muted whitespace-nowrap">{formatDate(p.updated_at)}</td>
                  <td className="py-2 px-3 text-right"><Link href={`/admin/person/${p.id}/edit`} className="text-sm">Edit</Link></td>
                </tr>
              )
            }) : (
              <tr><td colSpan={7} className="py-12 text-center text-muted">{query ? 'No people match your search.' : 'No people yet. Add one to get started.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination currentPage={page} totalPages={totalPages} totalCount={total} perPage={perPage} basePath="/admin/person" searchParams={{ q: query || undefined }} />
    </div>
  )
}
