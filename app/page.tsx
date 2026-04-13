import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { SearchBar } from '@/components/search/SearchBar'
import Link from 'next/link'
import { Suspense } from 'react'

export default function HomePage() {
  return (
    <>
      <Header />
      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-navy via-navy-light/50 to-navy" />
          {/* Abstract constellation dots */}
          <div className="absolute inset-0 opacity-20">
            <svg className="w-full h-full" viewBox="0 0 800 400">
              <circle cx="150" cy="100" r="3" fill="#D4A843" />
              <circle cx="300" cy="180" r="2.5" fill="#D4A843" />
              <circle cx="450" cy="120" r="3.5" fill="#D4A843" />
              <circle cx="600" cy="200" r="2" fill="#D4A843" />
              <circle cx="250" cy="280" r="3" fill="#0E4D6B" />
              <circle cx="500" cy="300" r="2.5" fill="#0E4D6B" />
              <circle cx="650" cy="150" r="3" fill="#D4A843" />
              <line x1="150" y1="100" x2="300" y2="180" stroke="#D4A843" strokeWidth="0.5" opacity="0.5" />
              <line x1="300" y1="180" x2="450" y2="120" stroke="#D4A843" strokeWidth="0.5" opacity="0.5" />
              <line x1="450" y1="120" x2="600" y2="200" stroke="#D4A843" strokeWidth="0.5" opacity="0.5" />
              <line x1="300" y1="180" x2="250" y2="280" stroke="#D4A843" strokeWidth="0.5" opacity="0.3" />
              <line x1="450" y1="120" x2="500" y2="300" stroke="#0E4D6B" strokeWidth="0.5" opacity="0.3" />
              <line x1="600" y1="200" x2="650" y2="150" stroke="#D4A843" strokeWidth="0.5" opacity="0.5" />
            </svg>
          </div>

          <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-24 sm:py-32 text-center">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white tracking-tight">
              Know who runs Hawai&#699;i.
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-white/60 max-w-2xl mx-auto">
              Hoku Constellation maps the people, money, and connections behind every major decision in the islands.
            </p>
            <div className="mt-8 max-w-xl mx-auto">
              <Suspense fallback={<div className="h-14 bg-navy-light rounded-lg animate-pulse" />}>
                <SearchBar size="lg" placeholder="Search people, organizations, offices..." />
              </Suspense>
            </div>
            <div className="mt-4 flex items-center justify-center gap-4 text-sm text-white/30">
              <span>Try:</span>
              <Link href="/search?q=governor" className="text-gold/60 hover:text-gold">Governor</Link>
              <Link href="/search?q=HECO" className="text-gold/60 hover:text-gold">HECO</Link>
              <Link href="/search?q=lobbyist" className="text-gold/60 hover:text-gold">Lobbyists</Link>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="py-16 border-t border-white/5">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-bold text-white text-center mb-12">How it works</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-gold/10 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">Search</h3>
                <p className="text-sm text-white/50">Find anyone in Hawai&#699;i public life — elected officials, lobbyists, donors, and the organizations that connect them.</p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-gold/10 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">Explore connections</h3>
                <p className="text-sm text-white/50">See who sits on which boards, who lobbies whom, and how organizations cluster around shared interests.</p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-gold/10 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">Follow the money</h3>
                <p className="text-sm text-white/50">Campaign contributions, lobbying expenditures, and financial disclosures — all linked to people and organizations.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Value proposition */}
        <section className="py-16 border-t border-white/5 bg-navy-light/30">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
              <div>
                <h2 className="text-2xl font-bold text-white mb-4">Public data, finally connected</h2>
                <p className="text-white/50 mb-4">
                  Campaign finance records. Lobbyist registrations. Ethics disclosures. PUC filings. It all exists — scattered across a dozen state websites in incompatible formats.
                </p>
                <p className="text-white/50 mb-6">
                  Hoku Constellation brings it together, links it to real people and organizations, and layers editorial analysis on top. The connections are the story.
                </p>
                <Link href="/pricing" className="inline-flex items-center bg-gold text-navy px-6 py-3 rounded-md font-semibold hover:bg-gold-light transition-colors">
                  Start your free trial
                </Link>
              </div>
              <div className="bg-navy-light rounded-lg border border-white/10 p-6 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-gold" />
                  <span className="text-sm text-white/70">Elected officials, lobbyists, donors, executives</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-ocean" />
                  <span className="text-sm text-white/70">Government agencies, corporations, nonprofits, PACs</span>
                </div>
                <div className="flex items-center gap-3">
                  <svg className="w-2 h-2 text-gold" viewBox="0 0 8 2"><line x1="0" y1="1" x2="8" y2="1" stroke="currentColor" strokeWidth="1" /></svg>
                  <span className="text-sm text-white/70">Relationships: employment, boards, lobbying, donations</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-gold text-xs">$</span>
                  <span className="text-sm text-white/70">Campaign contributions indexed and linked</span>
                </div>
                <div className="flex items-center gap-3">
                  <svg className="w-2 h-2 text-white/40" viewBox="0 0 8 8"><rect width="8" height="8" fill="currentColor" rx="1" /></svg>
                  <span className="text-sm text-white/70">Original reporting from Hoku.fm</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing preview */}
        <section className="py-16 border-t border-white/5">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-2xl font-bold text-white mb-4">Simple pricing</h2>
            <p className="text-white/50 mb-8">Free to search. Subscribe for full access to Hawai&#699;i&apos;s most comprehensive power-mapping database.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl mx-auto">
              <div className="bg-navy-light rounded-lg border border-white/10 p-6">
                <h3 className="font-semibold text-white mb-1">Free</h3>
                <p className="text-2xl font-bold text-white mb-4">$0</p>
                <p className="text-sm text-white/40">Search and browse basic profiles</p>
              </div>
              <div className="bg-navy-light rounded-lg border border-gold/30 p-6 ring-1 ring-gold/20">
                <h3 className="font-semibold text-gold mb-1">Individual</h3>
                <p className="text-2xl font-bold text-white mb-4">$9.99<span className="text-sm font-normal text-white/40">/mo</span></p>
                <p className="text-sm text-white/40">Full profiles, finance data, constellation maps</p>
              </div>
              <div className="bg-navy-light rounded-lg border border-white/10 p-6">
                <h3 className="font-semibold text-white mb-1">Professional</h3>
                <p className="text-2xl font-bold text-white mb-4">$29.99<span className="text-sm font-normal text-white/40">/mo</span></p>
                <p className="text-sm text-white/40">API access, CSV exports, email alerts</p>
              </div>
            </div>
            <Link href="/pricing" className="inline-block mt-8 text-sm text-gold/70 hover:text-gold">
              View full pricing details &rarr;
            </Link>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 border-t border-white/5">
          <div className="max-w-2xl mx-auto px-4 text-center">
            <p className="text-xs text-white/30 uppercase tracking-wider mb-3">by Hoku.fm</p>
            <h2 className="text-2xl font-bold text-white mb-4">Mapping Hawai&#699;i&apos;s power structure</h2>
            <p className="text-white/50 mb-6">
              Independent journalism needs independent data infrastructure. Hoku Constellation is built by Hawai&#699;i&apos;s independent media network.
            </p>
            <Link href="/auth/signup" className="inline-flex items-center bg-gold text-navy px-8 py-3 rounded-md font-semibold hover:bg-gold-light transition-colors">
              Get started
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
