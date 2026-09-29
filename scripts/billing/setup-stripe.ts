#!/usr/bin/env -S npx tsx --tsconfig tsconfig.scripts.json
/**
 * Creates (or finds) the HOKU Insider products, prices, coupons, and promotion codes described in
 * config/pricing.json, then prints the env lines to paste into Vercel / workers/.env.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/billing/setup-stripe.ts            # test mode (sk_test_…)
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/billing/setup-stripe.ts --dry      # print the plan only
 *
 * Live mode is refused unless both --live and --owner-confirmed are passed with an sk_live_ key.
 * Idempotent: prices are found by lookup_key, coupons by id, products by metadata.hoku_plan.
 */
import Stripe from 'stripe'
import { PRICING, type PaidPlan, type Interval } from '@/lib/billing/plans'

async function main() {
  const args = new Set(process.argv.slice(2))
  const key = process.env.STRIPE_SECRET_KEY ?? ''
  const dry = args.has('--dry')
  const live = key.startsWith('sk_live_')
  if (!dry && !key) throw new Error('STRIPE_SECRET_KEY is required')
  if (live && !(args.has('--live') && args.has('--owner-confirmed'))) {
    throw new Error('Refusing to create live Stripe objects. Follow docs/PRICING.md; pass --live --owner-confirmed only with the owner’s approval.')
  }
  const stripe = dry ? null : new Stripe(key)
  const env: string[] = []
  for (const plan of Object.keys(PRICING.plans) as PaidPlan[]) {
    const cfg = PRICING.plans[plan]
    console.log(`product ${cfg.name}${cfg.seatBased ? ' (per seat)' : ''}`)
    let productId = 'prod_dry'
    if (stripe) {
      const found = await stripe.products.search({ query: `metadata['hoku_plan']:'${plan}'` })
      productId = found.data[0]?.id ?? (await stripe.products.create({ name: `HOKU Insider ${cfg.name}`, description: cfg.tagline, metadata: { hoku_plan: plan } })).id
    }
    for (const [interval, p] of Object.entries(cfg.prices) as Array<[Interval, { amount: number; env: string; lookupKey: string }]>) {
      console.log(`  price ${p.lookupKey}: ${p.amount / 100} ${PRICING.currency}/${interval}${cfg.seatBased ? ' per seat' : ''}`)
      let id = `price_dry_${p.lookupKey}`
      if (stripe) {
        const existing = await stripe.prices.list({ lookup_keys: [p.lookupKey], limit: 1 })
        id = existing.data[0]?.id ?? (await stripe.prices.create({
          product: productId, currency: PRICING.currency, unit_amount: p.amount, recurring: { interval, usage_type: 'licensed' },
          lookup_key: p.lookupKey, nickname: `${cfg.name} ${interval}ly${cfg.seatBased ? ' per seat' : ''}`, metadata: { hoku_plan: plan },
        })).id
      }
      env.push(`${p.env}=${id}`)
    }
  }
  for (const [k, c] of Object.entries(PRICING.coupons)) {
    const id = `hoku_${k}`
    console.log(`coupon ${id}: ${c.percentOff}% off, ${c.duration}${c.durationInMonths ? ` (${c.durationInMonths} months)` : ''}; promotion code ${c.code}`)
    if (stripe) {
      const existing = await stripe.coupons.retrieve(id).catch(() => null)
      if (!existing) await stripe.coupons.create({ id, name: c.name, percent_off: c.percentOff, duration: c.duration, duration_in_months: c.durationInMonths, metadata: { hoku_coupon: k } })
      const codes = await stripe.promotionCodes.list({ code: c.code, limit: 1 })
      if (!codes.data.length) await stripe.promotionCodes.create({ promotion: { type: 'coupon', coupon: id }, code: c.code })
    }
    env.push(`${c.env}=${id}`)
  }
  console.log(`\n# ${dry ? 'planned' : live ? 'LIVE' : 'test-mode'} env\n${env.join('\n')}`)
}

main().catch(e => { console.error(e.message); process.exit(1) })
