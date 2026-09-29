import type { Metadata } from 'next'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { PricingTiers, type Tier } from '@/components/pricing/PricingTiers'
import { buttonClass } from '@/components/ui/Button'
import { PRICING, formatUsd } from '@/lib/billing/plans'
import { getSessionUser } from '@/lib/auth'

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'HOKU Insider plans for readers and for government-relations professionals: legislative tracking, alerts, client reports, briefings, and Q&A.',
}

const p = PRICING.plans

const tiers: Tier[] = [
  {
    id: 'reader', name: p.reader.name, monthly: formatUsd(p.reader.prices.month!.amount), yearly: null,
    description: p.reader.tagline, features: p.reader.features, cta: 'Choose Reader', highlighted: false,
    href: '/workspace/billing?plan=reader&interval=month',
  },
  {
    id: 'pro', name: p.pro.name, monthly: formatUsd(p.pro.prices.month!.amount), yearly: formatUsd(p.pro.prices.year!.amount), unit: 'per seat',
    description: p.pro.tagline, features: p.pro.features, cta: 'Choose Pro', highlighted: true,
  },
  {
    id: 'organization', name: p.organization.name, monthly: 'Custom', yearly: 'Custom',
    description: p.organization.tagline, features: p.organization.features, cta: 'Talk to us', highlighted: false,
    href: 'mailto:constellation@hoku.fm?subject=HOKU%20Insider%20Organization%20plan',
  },
]

export default async function PricingPage() {
  const user = await getSessionUser()
  return (
    <>
      <Header signedIn={!!user} />
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold">Pricing</h1>
          <p className="mt-4 text-lg text-muted">Free to search. Subscribe for the records, the alerts, and the reports.</p>
        </div>

        <PricingTiers tiers={tiers} defaultInterval={PRICING.defaultInterval === 'year' ? 'yearly' : 'monthly'} />

        <div className="grid md:grid-cols-2 gap-6 mt-16">
          <div className="border border-rule p-6">
            <h2 className="text-lg font-bold mb-2">Nonprofits and newsrooms</h2>
            <p className="text-sm text-muted">{PRICING.coupons.nonprofit.percentOff}% off Pro and Organization for 501(c)(3) nonprofits, unions, and newsrooms. Choose the discount at checkout; we verify eligibility afterward.</p>
          </div>
          <div className="border border-rule p-6">
            <h2 className="text-lg font-bold mb-2">Invoice billing</h2>
            <p className="text-sm text-muted">Pay by invoice (net {PRICING.invoice.daysUntilDue}) with your PO number on every invoice. Available on Pro and Organization from the billing page.</p>
          </div>
        </div>

        <div className="border border-rule p-8 text-center max-w-2xl mx-auto mt-12">
          <h2 className="text-xl font-bold mb-2">Free account</h2>
          <p className="text-muted mb-4">Search the database, see basic profiles, and keep a watchlist of up to 10 items.</p>
          <a href="/auth/signup" className={buttonClass('secondary')}>Create free account</a>
        </div>
      </main>
      <Footer />
    </>
  )
}
