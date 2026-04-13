import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function AdminOrgList({
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
    .from('organization')
    .select('id, name, slug, org_type, sector, island, status, updated_at', { count: 'exact' })
    .order('updated_at', { ascending: false })
    .range(offset, offset + perPage - 1)

  if (query) {
    dbQuery = dbQuery.ilike('name', `%${query}%`)
  }

  const { data: orgs, count } = await dbQuery
  const totalPages = Math.ceil((count || 0) / perPage)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Organizations</h1>
        <Link
          href="/admin/org/new"
          className="bg-gold text-navy px-4 py-2 rounded-md text-sm font-semibold hover:bg-gold-light transition-colors"
        >
          + Add Organization
        </Link>
      </div>

      <form className="mb-6">
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder="Search organizations..."
          className="w-full max-w-md rounded-md border border-white/20 bg-navy px-4 py-2 text-white placeholder-white/40 focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
        />
      </form>

      <div className="bg-navy-light rounded-lg border border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left py-3 px-4 text-white/50 font-medium">Name</th>
              <th className="text-left py-3 px-4 text-white/50 font-medium">Type</th>
              <th className="text-left py-3 px-4 text-white/50 font-medium">Sector</th>
              <th className="text-left py-3 px-4 text-white/50 font-medium">Island</th>
              <th className="text-left py-3 px-4 text-white/50 font-medium">Status</th>
              <th className="py-3 px-4"></th>
            </tr>
          </thead>
          <tbody>
            {orgs && orgs.length > 0 ? (
              orgs.map((org) => (
                <tr key={org.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-3 px-4 font-medium text-white">{org.name}</td>
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center rounded-full bg-ocean/20 px-2 py-0.5 text-xs text-white/70">
                      {(org.org_type || '').replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-white/60">{(org.sector || '').replace(/_/g, ' ') || '—'}</td>
                  <td className="py-3 px-4 text-white/60">{org.island || '—'}</td>
                  <td className="py-3 px-4">
                    <span className={`text-xs ${org.status === 'active' ? 'text-green-400' : 'text-white/40'}`}>
                      {org.status}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <Link href={`/admin/org/${org.id}/edit`} className="text-gold/70 hover:text-gold text-sm">
                      Edit
                    </Link>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="py-12 text-center text-white/40">
                  {query ? 'No organizations found.' : 'No organizations yet. Add one to get started.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={`/admin/org?q=${query}&page=${p}`}
              className={`px-3 py-1.5 rounded text-sm ${
                p === page ? 'bg-gold text-navy font-semibold' : 'text-white/50 hover:text-white'
              }`}
            >
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
