import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Choose your Hoku Constellation subscription plan. Free to search, subscribe for full access.',
}

const tiers = [
  {
    name: 'Free',
    price: '$0',
    period: '',
    description: 'Search and browse basic profiles',
    features: [
      'Search the database',
      'View basic profile info (name, office, party, island)',
      'See aggregate campaign finance totals',
      'Browse by office, sector, and island',
    ],
    cta: 'Create free account',
    ctaHref: '/auth/signup',
    highlighted: false,
  },
  {
    name: 'Individual',
    price: '$9.99',
    period: '/mo',
    yearlyPrice: '$99/yr',
    description: 'Full access for researchers and engaged citizens',
    features: [
      'Full access to all profiles',
      'Complete campaign finance detail',
      'Individual donor records',
      'Relationship constellation maps',
      'Ethics disclosures and PUC records',
      'All linked reporting',
      'Timeline view',
      '14-day free trial',
    ],
    cta: 'Start free trial',
    ctaHref: '/auth/signup?plan=individual',
    highlighted: true,
  },
  {
    name: 'Professional',
    price: '$29.99',
    period: '/mo',
    yearlyPrice: '$299/yr',
    description: 'For journalists, researchers, and policy professionals',
    features: [
      'Everything in Individual',
      'REST API access (JSON)',
      'CSV export of search results and donor lists',
      'Email alerts when tracked profiles are updated',
      'Priority access to new entity profiles',
      '14-day free trial',
    ],
    cta: 'Start free trial',
    ctaHref: '/auth/signup?plan=professional',
    highlighted: false,
  },
]

export default function PricingPage() {
  return (
    <>
      <Header />
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-12">
          <h1 className="text-3xl sm:text-4xl font-bold text-white">Simple, transparent pricing</h1>
          <p className="mt-4 text-lg text-white/50">
            Free to search. Subscribe for the full picture.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`rounded-lg border p-6 flex flex-col ${
                tier.highlighted
                  ? 'border-gold/40 bg-navy-light ring-1 ring-gold/20'
                  : 'border-white/10 bg-navy-light'
              }`}
            >
              <h2 className={`text-lg font-semibold ${tier.highlighted ? 'text-gold' : 'text-white'}`}>
                {tier.name}
              </h2>
              <div className="mt-2 mb-1">
                <span className="text-3xl font-bold text-white">{tier.price}</span>
                {tier.period && <span className="text-white/40">{tier.period}</span>}
              </div>
              {tier.yearlyPrice && (
                <p className="text-xs text-white/30 mb-3">or {tier.yearlyPrice} (save ~17%)</p>
              )}
              <p className="text-sm text-white/50 mb-6">{tier.description}</p>

              <ul className="space-y-2.5 mb-8 flex-1">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm">
                    <svg className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-white/60">{feature}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={tier.ctaHref}
                className={`block text-center py-2.5 rounded-md font-semibold text-sm transition-colors ${
                  tier.highlighted
                    ? 'bg-gold text-navy hover:bg-gold-light'
                    : 'bg-white/5 text-white border border-white/20 hover:border-gold/30'
                }`}
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>

        {/* Institutional */}
        <div className="bg-navy-light rounded-lg border border-white/10 p-8 text-center max-w-2xl mx-auto">
          <h2 className="text-xl font-semibold text-white mb-2">Institutional</h2>
          <p className="text-white/50 mb-4">
            For newsrooms, universities, law firms, and government offices. Multiple seats, custom data requests, SLA.
          </p>
          <a
            href="mailto:constellation@hoku.fm"
            className="inline-flex items-center bg-white/5 border border-white/20 text-white px-6 py-2.5 rounded-md font-semibold text-sm hover:border-gold/30 transition-colors"
          >
            Contact us
          </a>
        </div>
      </main>
      <Footer />
    </>
  )
}
