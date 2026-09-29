import Link from 'next/link'
import { Suspense } from 'react'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { SearchBar } from '@/components/search/SearchBar'
import { buttonClass } from '@/components/ui/Button'
import { PRICING, formatUsd } from '@/lib/billing/plans'

export default function HomePage() {
  return (
    <>
      <Header />
      <main className="flex-1">
        <section className="border-b border-rule">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
            <p className="text-xs font-bold uppercase tracking-wide text-muted mb-4">HOKU Insider · by Hoku.fm</p>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold">Know who runs Hawaiʻi.</h1>
            <p className="mt-6 text-lg sm:text-xl text-muted max-w-2xl">
              HOKU Insider maps the people, money, and connections behind every major decision in the islands.
            </p>
            <div className="mt-8 max-w-xl">
              <Suspense fallback={<div className="h-14 bg-gray-100 animate-pulse" />}>
                <SearchBar size="lg" placeholder="Search people, organizations, bills…" />
              </Suspense>
            </div>
            <p className="mt-4 text-sm text-muted">
              Try: <Link href="/search?q=governor">Governor</Link> · <Link href="/search?q=HECO">HECO</Link> · <Link href="/search?type=person&entityType=lobbyist">Lobbyists</Link>
            </p>
          </div>
        </section>

        <section className="border-b border-rule">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
            <h2 className="text-3xl font-bold mb-10">How it works</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted mb-2">01</p>
                <h3 className="text-xl font-bold mb-2">Search</h3>
                <p className="text-muted">Find anyone in Hawaiʻi public life: elected officials, lobbyists, donors, and the organizations that connect them.</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted mb-2">02</p>
                <h3 className="text-xl font-bold mb-2">Explore connections</h3>
                <p className="text-muted">See who sits on which boards, who lobbies whom, and how organizations cluster around shared interests.</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted mb-2">03</p>
                <h3 className="text-xl font-bold mb-2">Follow the money</h3>
                <p className="text-muted">Campaign contributions, lobbying expenditures, contracts, and financial disclosures, all linked to people and organizations.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-rule">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 grid grid-cols-1 md:grid-cols-2 gap-12 items-start">
            <div>
              <h2 className="text-3xl font-bold mb-4">Public data, finally connected</h2>
              <p className="text-muted mb-4">
                Campaign finance records. Lobbyist registrations. Ethics disclosures. PUC filings. Procurement awards. It all exists, scattered across a dozen government websites in incompatible formats.
              </p>
              <p className="text-muted mb-6">
                HOKU Insider brings it together, links it to real people and organizations, and layers editorial analysis on top. The connections are the story.
              </p>
              <Link href="/pricing" className={buttonClass('primary', 'lg')}>Start your free trial</Link>
            </div>
            <ul className="border border-rule divide-y divide-rule text-sm">
              <li className="p-4">Elected officials, lobbyists, donors, executives</li>
              <li className="p-4">Government agencies, corporations, nonprofits, PACs</li>
              <li className="p-4">Relationships: employment, boards, lobbying, donations</li>
              <li className="p-4">Campaign contributions indexed and linked</li>
              <li className="p-4">Bills, dockets, contracts, and property records</li>
              <li className="p-4">Original reporting from Hoku.fm</li>
            </ul>
          </div>
        </section>

        <section className="border-b border-rule">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
            <h2 className="text-3xl font-bold mb-2">Pricing</h2>
            <p className="text-muted mb-8">Free to search. Reader for the full record; Pro for legislative tracking, alerts, and client reports.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="border border-rule p-6">
                <h3 className="font-bold mb-1">{PRICING.plans.reader.name}</h3>
                <p className="text-3xl font-bold mb-3 tabular">{formatUsd(PRICING.plans.reader.prices.month!.amount)}<span className="text-sm font-normal text-muted">/mo</span></p>
                <p className="text-sm text-muted">{PRICING.plans.reader.tagline}</p>
              </div>
              <div className="border border-ink p-6">
                <h3 className="font-bold mb-1">{PRICING.plans.pro.name}</h3>
                <p className="text-3xl font-bold mb-3 tabular">{formatUsd(PRICING.plans.pro.prices.year!.amount)}<span className="text-sm font-normal text-muted">/yr per seat</span></p>
                <p className="text-sm text-muted">{PRICING.plans.pro.tagline}</p>
              </div>
              <div className="border border-rule p-6">
                <h3 className="font-bold mb-1">{PRICING.plans.organization.name}</h3>
                <p className="text-3xl font-bold mb-3">Custom</p>
                <p className="text-sm text-muted">{PRICING.plans.organization.tagline}</p>
              </div>
            </div>
            <p className="mt-6 text-sm"><Link href="/pricing">View full pricing details &rarr;</Link></p>
          </div>
        </section>

        <section>
          <div className="max-w-2xl mx-auto px-4 py-16 text-center">
            <p className="text-xs font-bold uppercase tracking-wide text-muted mb-3">by Hoku.fm</p>
            <h2 className="text-3xl font-bold mb-4">Mapping Hawaiʻi&apos;s power structure</h2>
            <p className="text-muted mb-6">
              Independent journalism needs independent data infrastructure. HOKU Insider is built by Hawaiʻi&apos;s independent media network.
            </p>
            <Link href="/auth/signup" className={buttonClass('primary', 'lg')}>Get started</Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
