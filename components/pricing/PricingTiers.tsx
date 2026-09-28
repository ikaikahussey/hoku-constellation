'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { buttonClass } from '@/components/ui/Button'
import { track, EVENTS } from '@/lib/analytics-events'

export interface Tier {
  id: string
  name: string
  monthly: string
  yearly: string | null
  description: string
  features: string[]
  cta: string
  highlighted: boolean
}

export function PricingTiers({ tiers }: { tiers: Tier[] }) {
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly')

  useEffect(() => {
    track(EVENTS.PRICING_VIEWED, {})
  }, [])

  return (
    <div>
      <div role="group" aria-label="Billing interval" className="flex justify-center mb-10">
        <div className="inline-flex border border-ink">
          {(['monthly', 'yearly'] as const).map(opt => (
            <button
              key={opt}
              type="button"
              aria-pressed={interval === opt}
              onClick={() => setInterval(opt)}
              className={`px-4 py-2 text-sm font-bold ${interval === opt ? 'bg-ink text-paper' : 'bg-paper text-ink'}`}
            >
              {opt === 'monthly' ? 'Monthly' : 'Yearly (save ~17%)'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {tiers.map(tier => {
          const price = interval === 'yearly' && tier.yearly ? tier.yearly : tier.monthly
          const period = tier.id === 'free' ? '' : interval === 'yearly' && tier.yearly ? '/yr' : '/mo'
          const href = tier.id === 'free' ? '/auth/signup' : `/auth/signup?plan=${tier.id}&interval=${interval}`
          return (
            <div key={tier.id} className={`p-6 flex flex-col border ${tier.highlighted ? 'border-ink border-2' : 'border-rule'}`}>
              <h2 className="text-xl font-bold">{tier.name}</h2>
              <p className="mt-2 mb-1 tabular">
                <span className="text-3xl font-bold">{price}</span>
                {period && <span className="text-muted">{period}</span>}
              </p>
              <p className="text-sm text-muted mb-6">{tier.description}</p>
              <ul className="space-y-2 mb-8 flex-1 text-sm">
                {tier.features.map(f => (
                  <li key={f} className="flex gap-2"><span aria-hidden="true">&mdash;</span><span>{f}</span></li>
                ))}
              </ul>
              <Link
                href={href}
                className={buttonClass(tier.highlighted ? 'primary' : 'secondary', 'md', 'w-full')}
                onClick={() => { if (tier.id !== 'free') track(EVENTS.CHECKOUT_STARTED, { tier: tier.id, interval }) }}
              >
                {tier.cta}
              </Link>
            </div>
          )
        })}
      </div>
    </div>
  )
}
