/**
 * Plan catalog read from config/pricing.json (prices live in config, not code). Stripe price and
 * coupon ids are resolved from the env vars the config names.
 */
import pricing from '@/config/pricing.json'

export type PaidPlan = 'reader' | 'pro' | 'organization'
export type Interval = 'month' | 'year'
export type CouponKey = keyof typeof pricing.coupons

interface PriceConfig { amount: number; env: string; lookupKey: string }
export interface PlanConfig {
  name: string; tagline: string; seatBased: boolean; minSeats: number; custom?: boolean
  prices: Partial<Record<Interval, PriceConfig>>; features: string[]
}

export const PRICING = pricing as unknown as {
  currency: string; defaultInterval: Interval; invoice: { daysUntilDue: number }
  plans: Record<PaidPlan, PlanConfig>
  coupons: Record<string, { name: string; percentOff: number; duration: 'forever' | 'once' | 'repeating'; durationInMonths?: number; env: string; code: string }>
}

export const PAID_PLANS = Object.keys(PRICING.plans) as PaidPlan[]

export function priceId(plan: PaidPlan, interval: Interval): string | null {
  const p = PRICING.plans[plan]?.prices[interval]
  return p ? (process.env[p.env]?.trim() || null) : null
}

export function couponId(key: string): string | null {
  const c = PRICING.coupons[key]
  return c ? (process.env[c.env]?.trim() || null) : null
}

/** Reverse lookup from a Stripe price id (webhooks). */
export function planForPrice(id: string | null | undefined): { plan: PaidPlan; interval: Interval } | null {
  if (!id) return null
  for (const plan of PAID_PLANS) for (const interval of ['month', 'year'] as Interval[]) {
    if (priceId(plan, interval) === id) return { plan, interval }
  }
  return null
}

export const formatUsd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0 })}`
