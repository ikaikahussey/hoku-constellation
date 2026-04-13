import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

async function getStats() {
  const supabase = await createClient()
  const [people, orgs, relationships, contributions, articles] = await Promise.all([
    supabase.from('person').select('*', { count: 'exact', head: true }),
    supabase.from('organization').select('*', { count: 'exact', head: true }),
    supabase.from('relationship').select('*', { count: 'exact', head: true }),
    supabase.from('contribution').select('*', { count: 'exact', head: true }),
    supabase.from('article').select('*', { count: 'exact', head: true }),
  ])
  return {
    people: people.count ?? 0,
    orgs: orgs.count ?? 0,
    relationships: relationships.count ?? 0,
    contributions: contributions.count ?? 0,
    articles: articles.count ?? 0,
  }
}

async function getUnmatchedCount() {
  const supabase = await createClient()
  const { count } = await supabase
    .from('contribution')
    .select('*', { count: 'exact', head: true })
    .eq('match_status', 'unmatched')
  return count ?? 0
}

export default async function AdminDashboard() {
  const [stats, unmatchedCount] = await Promise.all([getStats(), getUnmatchedCount()])

  const statCards = [
    { label: 'People', value: stats.people, href: '/admin/person' },
    { label: 'Organizations', value: stats.orgs, href: '/admin/org' },
    { label: 'Relationships', value: stats.relationships, href: '#' },
    { label: 'Contributions', value: stats.contributions, href: '/admin/import' },
    { label: 'Articles', value: stats.articles, href: '/admin/articles' },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Admin Dashboard</h1>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        {statCards.map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="bg-navy-light rounded-lg border border-white/10 p-4 hover:border-gold/30 transition-colors"
          >
            <p className="text-2xl font-bold text-gold">{stat.value.toLocaleString()}</p>
            <p className="text-sm text-white/50">{stat.label}</p>
          </Link>
        ))}
      </div>

      {unmatchedCount > 0 && (
        <div className="bg-warning/10 border border-warning/30 rounded-lg p-4 mb-8">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-warning">
                {unmatchedCount} unmatched contribution records
              </p>
              <Link href="/admin/match-review" className="text-xs text-white/50 hover:text-gold">
                Review matches &rarr;
              </Link>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-navy-light rounded-lg border border-white/10 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>
          <div className="space-y-2">
            <Link href="/admin/person/new" className="flex items-center gap-2 text-sm text-white/60 hover:text-gold transition-colors">
              <span className="text-gold">+</span> Add a person
            </Link>
            <Link href="/admin/org/new" className="flex items-center gap-2 text-sm text-white/60 hover:text-gold transition-colors">
              <span className="text-gold">+</span> Add an organization
            </Link>
            <Link href="/admin/import" className="flex items-center gap-2 text-sm text-white/60 hover:text-gold transition-colors">
              <span className="text-gold">&uarr;</span> Import data
            </Link>
            <Link href="/admin/bulk-create" className="flex items-center gap-2 text-sm text-white/60 hover:text-gold transition-colors">
              <span className="text-gold">&uarr;</span> Bulk create entities
            </Link>
          </div>
        </div>

        <div className="bg-navy-light rounded-lg border border-white/10 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Recent Activity</h2>
          <p className="text-sm text-white/40">Activity log will appear here as entities are created and updated.</p>
        </div>
      </div>
    </div>
  )
}
