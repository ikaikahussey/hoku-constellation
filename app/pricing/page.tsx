import type { Metadata } from 'next'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { PricingTiers, type Tier } from '@/components/pricing/PricingTiers'
import { buttonClass } from '@/components/ui/Button'

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Choose your HOKU Insider subscription. Free to search, subscribe for full access.',
}

const tiers: Tier[] = [
  {
    id: 'free',
    name: 'Free',
    monthly: '$0',
    yearly: null,
    description: 'Search and browse basic profiles',
    features: [
      'Search the database',
      'View basic profile info (name, office, party, island)',
      'Positions, board seats, and public connections',
      'Browse by office, sector, and island',
    ],
    cta: 'Create free account',
    highlighted: false,
  },
  {
    id: 'individual',
    name: 'Individual',
    monthly: '$9.99',
    yearly: '$99',
    description: 'Full access for researchers and engaged citizens',
    features: [
      'Full access to all profiles',
      'Complete campaign finance detail',
      'Individual donor records',
      'Relationship graphs',
      'Lobbying, ethics disclosures, and PUC records',
      'Legislative testimony and contracts',
      'All linked reporting and timelines',
      '14-day free trial',
    ],
    cta: 'Start free trial',
    highlighted: true,
  },
  {
    id: 'professional',
    name: 'Professional',
    monthly: '$29.99',
    yearly: '$299',
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
    highlighted: false,
  },
]

export default function PricingPage() {
  return (
    <>
      <Header />
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold">Simple, transparent pricing</h1>
          <p className="mt-4 text-lg text-muted">Free to search. Subscribe for the full picture.</p>
        </div>

        <PricingTiers tiers={tiers} />

        <div className="border border-rule p-8 text-center max-w-2xl mx-auto mt-16">
          <h2 className="text-xl font-bold mb-2">Institutional</h2>
          <p className="text-muted mb-4">
            For newsrooms, universities, law firms, and government offices. Multiple seats, custom data requests, SLA.
          </p>
          <a href="mailto:constellation@hoku.fm" className={buttonClass('secondary')}>Contact us</a>
        </div>
      </main>
      <Footer />
    </>
  )
}
