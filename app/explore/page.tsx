import Link from 'next/link'
import type { Metadata } from 'next'
import { getServiceDb } from '@/lib/db/service'
import { listEntities, countEntities } from '@/lib/db/queries'
import type { EntityRow } from '@/lib/db/types'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { attr } from '@/components/profile/edges'
import { EXPLORE_CATEGORIES, categoriesInGroup, categoryListOptions, exploreHref } from '@/lib/explore/categories'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Explore',
  description: 'Browse Hawaiʻi’s power structure by office, sector, island, and featured profiles.',
}

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
  const [featuredPeople, featuredOrgs, recentPeople, counts] = await Promise.all([
    listEntities(db, { kind: 'person', featured: true, status: 'active', limit: 8, orderBy: 'name' }),
    listEntities(db, { kind: 'org', featured: true, status: 'active', limit: 8, orderBy: 'name' }),
    listEntities(db, { kind: 'person', limit: 5, orderBy: 'created_at' }),
    Promise.all(EXPLORE_CATEGORIES.map(async c => [c.slug, await countEntities(db, categoryListOptions(c))] as const)),
  ])
  const countFor = new Map<string, number>(counts)
  const Count = ({ slug }: { slug: string }) => {
    const n = countFor.get(slug) ?? 0
    return <span className="text-sm text-muted tabular ml-2">{n.toLocaleString('en-US')}</span>
  }

  return (
    <>
      <Header />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold mb-10">Explore</h1>

        <section className="mb-12">
          <h2 className="text-xs font-bold uppercase tracking-wide mb-3 pb-1 border-b border-ink">By office</h2>
          <ul className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {categoriesInGroup('office').map(item => (
              <li key={item.slug} className="card border border-rule p-4 hover:border-ink transition-colors">
                <Link href={exploreHref(item.slug)} className="font-bold">{item.label}</Link>
                <Count slug={item.slug} />
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-12">
          <h2 className="text-xs font-bold uppercase tracking-wide mb-3 pb-1 border-b border-ink">By sector</h2>
          <ul className="flex flex-wrap gap-2">
            {categoriesInGroup('sector').map(item => (
              <li key={item.slug}>
                <Link href={exploreHref(item.slug)} className="link-quiet inline-block border border-ink px-4 py-2 text-sm">{item.label}<span className="text-muted tabular ml-2">{(countFor.get(item.slug) ?? 0).toLocaleString('en-US')}</span></Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-12">
          <h2 className="text-xs font-bold uppercase tracking-wide mb-3 pb-1 border-b border-ink">By island</h2>
          <ul className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {categoriesInGroup('island').map(island => (
              <li key={island.slug} className="card border border-rule p-4 hover:border-ink transition-colors">
                <Link href={exploreHref(island.slug)} className="font-bold">{island.label}</Link>
                <Count slug={island.slug} />
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
