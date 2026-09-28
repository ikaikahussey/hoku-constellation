import Link from 'next/link'
import type { Metadata } from 'next'
import { getServiceDb } from '@/lib/db/service'
import { listEntities } from '@/lib/db/queries'
import type { EntityRow } from '@/lib/db/types'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { attr } from '@/components/profile/edges'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Explore',
  description: 'Browse Hawaiʻi’s power structure by office, sector, island, and featured profiles.',
}

const BROWSE_BY_OFFICE = [
  { label: 'Elected officials', href: '/search?type=person&entityType=elected_official' },
  { label: 'Appointed officials', href: '/search?type=person&entityType=appointed_official' },
  { label: 'County mayors', href: '/search?q=mayor&type=person' },
  { label: 'PUC commissioners', href: '/search?q=PUC&type=person' },
]

const BROWSE_BY_SECTOR = [
  { label: 'Energy', value: 'energy' },
  { label: 'Real estate', value: 'real_estate' },
  { label: 'Healthcare', value: 'healthcare' },
  { label: 'Tourism', value: 'tourism' },
  { label: 'Construction', value: 'construction' },
  { label: 'Finance', value: 'finance' },
]

const BROWSE_BY_ISLAND = [
  { label: 'Oʻahu', value: 'Oahu' },
  { label: 'Maui', value: 'Maui' },
  { label: 'Hawaiʻi Island', value: 'Hawaii' },
  { label: 'Kauaʻi', value: 'Kauai' },
]

function EntityTile({ e }: { e: EntityRow }) {
  const slug = attr(e, 'slug')
  const href = e.kind === 'person' ? `/person/${slug}` : `/org/${slug}`
  const sub = e.kind === 'person' ? attr(e, 'office_held') : attr(e, 'org_type')?.replace(/_/g, ' ')
  return (
    <div className="card border border-rule p-4 hover:border-ink transition-colors">
      <p className="font-bold truncate">{slug ? <Link href={href}>{e.name}</Link> : e.name}</p>
      {sub && <p className="text-sm text-muted truncate">{sub}</p>}
    </div>
  )
}

export default async function ExplorePage() {
  const db = await getServiceDb()
  const [featuredPeople, featuredOrgs, recentPeople] = await Promise.all([
    listEntities(db, { kind: 'person', featured: true, status: 'active', limit: 8, orderBy: 'name' }),
    listEntities(db, { kind: 'org', featured: true, status: 'active', limit: 8, orderBy: 'name' }),
    listEntities(db, { kind: 'person', limit: 5, orderBy: 'created_at' }),
  ])

  return (
    <>
      <Header />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold mb-10">Explore</h1>

        <section className="mb-12">
          <h2 className="text-xs font-bold uppercase tracking-wide mb-3 pb-1 border-b border-ink">By office</h2>
          <ul className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {BROWSE_BY_OFFICE.map(item => (
              <li key={item.label} className="card border border-rule p-4 hover:border-ink transition-colors">
                <Link href={item.href} className="font-bold">{item.label}</Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-12">
          <h2 className="text-xs font-bold uppercase tracking-wide mb-3 pb-1 border-b border-ink">By sector</h2>
          <ul className="flex flex-wrap gap-2">
            {BROWSE_BY_SECTOR.map(item => (
              <li key={item.value}>
                <Link href={`/search?type=organization&sector=${item.value}`} className="link-quiet inline-block border border-ink px-4 py-2 text-sm">{item.label}</Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-12">
          <h2 className="text-xs font-bold uppercase tracking-wide mb-3 pb-1 border-b border-ink">By island</h2>
          <ul className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {BROWSE_BY_ISLAND.map(island => (
              <li key={island.value} className="card border border-rule p-4 hover:border-ink transition-colors">
                <Link href={`/search?island=${island.value}`} className="font-bold">{island.label}</Link>
              </li>
            ))}
          </ul>
        </section>

        {featuredPeople.rows.length > 0 && (
          <section className="mb-12">
            <h2 className="text-xs font-bold uppercase tracking-wide mb-3 pb-1 border-b border-ink">Featured people</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {featuredPeople.rows.map(p => <EntityTile key={p.id} e={p} />)}
            </div>
          </section>
        )}

        {featuredOrgs.rows.length > 0 && (
          <section className="mb-12">
            <h2 className="text-xs font-bold uppercase tracking-wide mb-3 pb-1 border-b border-ink">Featured organizations</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {featuredOrgs.rows.map(o => <EntityTile key={o.id} e={o} />)}
            </div>
          </section>
        )}

        {recentPeople.rows.length > 0 && (
          <section className="mb-12">
            <h2 className="text-xs font-bold uppercase tracking-wide mb-3 pb-1 border-b border-ink">Recently added</h2>
            <ul className="divide-y divide-rule">
              {recentPeople.rows.map(p => {
                const slug = attr(p, 'slug')
                const office = attr(p, 'office_held')
                return (
                  <li key={p.id} className="py-2.5 flex items-baseline gap-3">
                    <span className="font-bold">{slug ? <Link href={`/person/${slug}`} className="link-quiet">{p.name}</Link> : p.name}</span>
                    {office && <span className="text-sm text-muted">{office}</span>}
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </main>
      <Footer />
    </>
  )
}
