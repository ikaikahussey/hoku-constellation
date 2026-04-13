import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Explore',
  description: 'Browse Hawai\u02BBi\u2019s power structure by office, sector, island, and featured constellations.',
}

async function getFeaturedPeople() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('person')
    .select('id, full_name, slug, office_held, entity_types, island, party')
    .eq('is_featured', true)
    .eq('status', 'active')
    .limit(8)
  return data || []
}

async function getFeaturedOrgs() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('organization')
    .select('id, name, slug, org_type, sector, island')
    .eq('is_featured', true)
    .eq('status', 'active')
    .limit(8)
  return data || []
}

async function getRecentPeople() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('person')
    .select('id, full_name, slug, office_held, entity_types')
    .order('created_at', { ascending: false })
    .limit(5)
  return data || []
}

const BROWSE_BY_OFFICE = [
  { label: 'State Senators', href: '/search?q=&entityType=elected_official&type=person', icon: 'M12 2L2 7h20L12 2z' },
  { label: 'State Representatives', href: '/search?q=&entityType=elected_official&type=person', icon: 'M12 2L2 7h20L12 2z' },
  { label: 'County Mayors', href: '/search?q=mayor&type=person', icon: 'M12 2L2 7h20L12 2z' },
  { label: 'PUC Commissioners', href: '/search?q=PUC&type=person', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
]

const BROWSE_BY_SECTOR = [
  { label: 'Energy', href: '/search?q=&type=organization&sector=energy', color: 'bg-yellow-500/20 text-yellow-300' },
  { label: 'Real Estate', href: '/search?q=&type=organization&sector=real_estate', color: 'bg-blue-500/20 text-blue-300' },
  { label: 'Healthcare', href: '/search?q=&type=organization&sector=healthcare', color: 'bg-green-500/20 text-green-300' },
  { label: 'Tourism', href: '/search?q=&type=organization&sector=tourism', color: 'bg-purple-500/20 text-purple-300' },
  { label: 'Construction', href: '/search?q=&type=organization&sector=construction', color: 'bg-orange-500/20 text-orange-300' },
  { label: 'Finance', href: '/search?q=&type=organization&sector=finance', color: 'bg-emerald-500/20 text-emerald-300' },
]

const BROWSE_BY_ISLAND = [
  { label: 'O\u02BBahu', value: 'Oahu' },
  { label: 'Maui', value: 'Maui' },
  { label: 'Hawai\u02BBi Island', value: 'Hawaii' },
  { label: 'Kaua\u02BBi', value: 'Kauai' },
]

export default async function ExplorePage() {
  const [featuredPeople, featuredOrgs, recentPeople] = await Promise.all([
    getFeaturedPeople(),
    getFeaturedOrgs(),
    getRecentPeople(),
  ])

  return (
    <>
      <Header />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-white mb-8">Explore</h1>

        {/* Browse by Office */}
        <section className="mb-12">
          <h2 className="text-lg font-semibold text-white mb-4">By Office</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {BROWSE_BY_OFFICE.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="bg-navy-light rounded-lg border border-white/10 p-4 hover:border-gold/30 transition-colors text-center"
              >
                <svg className="w-6 h-6 text-gold mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
                </svg>
                <p className="text-sm text-white/70">{item.label}</p>
              </Link>
            ))}
          </div>
        </section>

        {/* Browse by Sector */}
        <section className="mb-12">
          <h2 className="text-lg font-semibold text-white mb-4">By Sector</h2>
          <div className="flex flex-wrap gap-2">
            {BROWSE_BY_SECTOR.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80 ${item.color}`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </section>

        {/* Browse by Island */}
        <section className="mb-12">
          <h2 className="text-lg font-semibold text-white mb-4">By Island</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {BROWSE_BY_ISLAND.map((island) => (
              <Link
                key={island.value}
                href={`/search?island=${island.value}`}
                className="bg-navy-light rounded-lg border border-white/10 p-4 hover:border-gold/30 transition-colors text-center"
              >
                <p className="text-sm font-medium text-white">{island.label}</p>
              </Link>
            ))}
          </div>
        </section>

        {/* Featured People */}
        {featuredPeople.length > 0 && (
          <section className="mb-12">
            <h2 className="text-lg font-semibold text-white mb-4">Featured People</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {featuredPeople.map((person) => (
                <Link
                  key={person.id}
                  href={`/person/${person.slug}`}
                  className="bg-navy-light rounded-lg border border-white/10 p-4 hover:border-gold/30 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-2 h-2 rounded-full bg-gold" />
                    <p className="text-sm font-medium text-white truncate">{person.full_name}</p>
                  </div>
                  {person.office_held && (
                    <p className="text-xs text-white/40 ml-4">{person.office_held}</p>
                  )}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Featured Organizations */}
        {featuredOrgs.length > 0 && (
          <section className="mb-12">
            <h2 className="text-lg font-semibold text-white mb-4">Featured Organizations</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {featuredOrgs.map((org) => (
                <Link
                  key={org.id}
                  href={`/org/${org.slug}`}
                  className="bg-navy-light rounded-lg border border-white/10 p-4 hover:border-gold/30 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-2 h-2 rounded-full bg-ocean" />
                    <p className="text-sm font-medium text-white truncate">{org.name}</p>
                  </div>
                  <p className="text-xs text-white/40 ml-4">{(org.org_type || '').replace(/_/g, ' ')}</p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Recent Additions */}
        {recentPeople.length > 0 && (
          <section className="mb-12">
            <h2 className="text-lg font-semibold text-white mb-4">Recently Added</h2>
            <div className="space-y-2">
              {recentPeople.map((person) => (
                <Link
                  key={person.id}
                  href={`/person/${person.slug}`}
                  className="flex items-center gap-3 bg-navy-light rounded-md border border-white/5 p-3 hover:border-gold/20 transition-colors"
                >
                  <span className="w-2 h-2 rounded-full bg-gold" />
                  <span className="text-sm text-white">{person.full_name}</span>
                  {person.office_held && <span className="text-xs text-white/30">{person.office_held}</span>}
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
      <Footer />
    </>
  )
}
