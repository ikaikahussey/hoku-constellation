import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import Pagination from '@/components/admin/Pagination'

export default async function AdminPersonList({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const params = await searchParams
  const query = params.q || ''
  const page = parseInt(params.page || '1')
  const perPage = 25
  const offset = (page - 1) * perPage

  const supabase = await createClient()

  let dbQuery = supabase
    .from('person')
    .select('id, full_name, slug, entity_types, office_held, island, status, updated_at', { count: 'exact' })
    .order('updated_at', { ascending: false })
    .range(offset, offset + perPage - 1)

  if (query) {
    dbQuery = dbQuery.ilike('full_name', `%${query}%`)
  }

  const { data: people, count } = await dbQuery
  const totalPages = Math.ceil((count || 0) / perPage)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">People</h1>
        <Link
          href="/admin/person/new"
          className="bg-gold text-navy px-4 py-2 rounded-md text-sm font-semibold hover:bg-gold-light transition-colors"
        >
          + Add Person
        </Link>
      </div>

      <form className="mb-6">
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder="Search people..."
          className="w-full max-w-md rounded-md border border-white/20 bg-navy px-4 py-2 text-white placeholder-white/40 focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
        />
      </form>

      <div className="bg-navy-light rounded-lg border border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left py-3 px-4 text-white/50 font-medium">Name</th>
              <th className="text-left py-3 px-4 text-white/50 font-medium">Type</th>
              <th className="text-left py-3 px-4 text-white/50 font-medium">Office</th>
              <th className="text-left py-3 px-4 text-white/50 font-medium">Island</th>
              <th className="text-left py-3 px-4 text-white/50 font-medium">Status</th>
              <th className="text-left py-3 px-4 text-white/50 font-medium">Updated</th>
              <th className="py-3 px-4"></th>
            </tr>
          </thead>
          <tbody>
            {people && people.length > 0 ? (
              people.map((person) => (
                <tr key={person.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-3 px-4 font-medium">
                    <Link href={`/admin/person/${person.id}`} className="text-white hover:text-gold">
                      {person.full_name}
                    </Link>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex flex-wrap gap-1">
                      {(person.entity_types || []).slice(0, 2).map((t: string) => (
                        <span key={t} className="inline-flex items-center rounded-full bg-gold/10 px-2 py-0.5 text-xs text-gold">
                          {t.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-white/60">{person.office_held || '—'}</td>
                  <td className="py-3 px-4 text-white/60">{person.island || '—'}</td>
                  <td className="py-3 px-4">
                    <span className={`text-xs ${person.status === 'active' ? 'text-green-400' : 'text-white/40'}`}>
                      {person.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-white/40 text-xs">
                    {person.updated_at ? new Date(person.updated_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="py-3 px-4">
                    <Link href={`/admin/person/${person.id}/edit`} className="text-gold/70 hover:text-gold text-sm">
                      Edit
                    </Link>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="py-12 text-center text-white/40">
                  {query ? 'No people found matching your search.' : 'No people yet. Add one to get started.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        totalCount={count ?? 0}
        perPage={perPage}
        basePath="/admin/person"
        searchParams={{ q: query || undefined }}
      />
    </div>
  )
}
