/**
 * E6/E10 — team billing: seat quantity changes with proration, annual default, invoice billing with
 * a PO number, coupons, and entitlement changes on upgrade, downgrade, and cancellation (including
 * the signed Stripe webhook route).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Stripe from 'stripe'
import { createTestDb, type TestDb } from './helpers/pglite'
import { fakeStripe } from './helpers/fake-stripe'
import { createTeam, inviteMember } from '@/lib/teams'
import { getEntitlements } from '@/lib/entitlements'
import { BillingError, cancelAtPeriodEnd, changePlan, changeSeats, createCheckout, createInvoiceSubscription, createPortalSession, handleTeamBillingEvent } from '@/lib/billing'
import { PRICING, planForPrice } from '@/lib/billing/plans'
import { setServiceDbForTests } from '@/lib/db/service'

Object.assign(process.env, {
  STRIPE_PRICE_READER_MONTHLY: 'price_reader_m', STRIPE_PRICE_PRO_MONTHLY: 'price_pro_m', STRIPE_PRICE_PRO_YEARLY: 'price_pro_y',
  STRIPE_PRICE_ORGANIZATION_YEARLY: 'price_org_y', STRIPE_COUPON_NONPROFIT: 'coupon_np40', STRIPE_COUPON_DESIGN_PARTNER: 'coupon_dp',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_secret', STRIPE_SECRET_KEY: 'sk_test_fake',
})

let db: TestDb
beforeAll(async () => { db = await createTestDb() })
afterAll(async () => { setServiceDbForTests(null); await db.end() })

const team = async (owner: string) => (await createTeam(db, owner, `Team ${owner}`, { email: `${owner}@example.com` })).id
const row = (id: string) => db.one<{ plan: string; subscription_status: string; seat_count: number; billing_interval: string; collection_method: string; po_number: string | null; is_design_partner: boolean; coupon_code: string | null }>(`select * from app.team where id = $1`, [id])

describe('pricing config', () => {
  it('lives in config with Pro at $200/seat/month or $2,000/seat/year and annual as the default', () => {
    expect(PRICING.plans.pro.prices.month!.amount).toBe(20000)
    expect(PRICING.plans.pro.prices.year!.amount).toBe(200000)
    expect(PRICING.plans.reader.prices.month!.amount).toBe(1500)
    expect(PRICING.plans.organization.minSeats).toBe(5)
    expect(PRICING.defaultInterval).toBe('year')
    expect(PRICING.coupons.nonprofit.percentOff).toBe(40)
    expect(planForPrice('price_pro_y')).toEqual({ plan: 'pro', interval: 'year' })
  })
})

describe('checkout', () => {
  it('creates an annual seat-quantity checkout with a coupon, owner/admin only', async () => {
    const { stripe, requests } = fakeStripe()
    const t = await team('co_owner')
    await expect(createCheckout(stripe, db, { teamId: t, userId: 'someone_else', email: null, plan: 'pro', seats: 3 })).rejects.toBeInstanceOf(BillingError)
    const s = await createCheckout(stripe, db, { teamId: t, userId: 'co_owner', email: 'co_owner@example.com', plan: 'pro', seats: 3, coupon: 'nonprofit' })
    expect(s.url).toMatch(/^https:\/\//)
    const req = requests.find(r => r.path === '/checkout/sessions')!.params
    expect(req).toMatchObject({ mode: 'subscription', 'line_items[0][price]': 'price_pro_y', 'line_items[0][quantity]': '3', 'discounts[0][coupon]': 'coupon_np40', client_reference_id: `team:${t}`, 'subscription_data[metadata][team_id]': t })
    expect(req.allow_promotion_codes).toBeUndefined()
    expect((await row(t))!.plan).toBe('free') // nothing changes until Stripe confirms
  })
  it('rejects unknown coupons, bad seat counts, and single-seat Reader with more seats', async () => {
    const { stripe } = fakeStripe()
    const t = await team('co_owner2')
    await expect(createCheckout(stripe, db, { teamId: t, userId: 'co_owner2', email: null, plan: 'pro', seats: 1, coupon: 'free_lunch' })).rejects.toThrow(/coupon/)
    await expect(createCheckout(stripe, db, { teamId: t, userId: 'co_owner2', email: null, plan: 'pro', seats: 0 })).rejects.toThrow(/positive/)
    await expect(createCheckout(stripe, db, { teamId: t, userId: 'co_owner2', email: null, plan: 'reader', interval: 'month', seats: 2 })).rejects.toThrow(/single-seat/)
    await expect(createCheckout(stripe, db, { teamId: t, userId: 'co_owner2', email: null, plan: 'reader', seats: 1 })).rejects.toThrow(/not available annually/)
  })
})

describe('invoice billing and seat changes', () => {
  it('invoice billing: net-30, PO number on invoices, Organization seats, entitlements follow', async () => {
    const { stripe, requests } = fakeStripe()
    const t = await team('inv_owner')
    await expect(createInvoiceSubscription(stripe, db, { teamId: t, userId: 'inv_owner', email: 'ap@example.org', plan: 'organization', seats: 3, poNumber: 'PO-7781' })).rejects.toThrow(/starts at 5 seats/)
    await createInvoiceSubscription(stripe, db, { teamId: t, userId: 'inv_owner', email: 'ap@example.org', plan: 'organization', seats: 6, poNumber: 'PO-7781' })
    const cust = requests.find(r => r.path === '/customers' && r.method === 'POST')!.params
    expect(cust).toMatchObject({ 'invoice_settings[custom_fields][0][name]': 'PO number', 'invoice_settings[custom_fields][0][value]': 'PO-7781' })
    const sub = requests.find(r => r.path === '/subscriptions')!.params
    expect(sub).toMatchObject({ collection_method: 'send_invoice', days_until_due: '30', 'items[0][price]': 'price_org_y', 'items[0][quantity]': '6' })
    expect(await row(t)).toMatchObject({ plan: 'organization', subscription_status: 'active', seat_count: 6, billing_interval: 'year', collection_method: 'send_invoice', po_number: 'PO-7781' })
    expect(await getEntitlements(db, 'inv_owner')).toMatchObject({ tier: 'organization', api: true, invoice_billing: true, qa_daily_limit: 300 })
  })

  it('changes seats with proration and refuses to drop below seats in use', async () => {
    const { stripe, requests } = fakeStripe()
    const t = await team('seat_owner')
    await createInvoiceSubscription(stripe, db, { teamId: t, userId: 'seat_owner', email: 'x@example.org', plan: 'pro', seats: 2 })
    await inviteMember(db, 'seat_owner', t, 'second@example.org')
    await expect(changeSeats(stripe, db, { teamId: t, userId: 'seat_owner', seats: 1 })).rejects.toThrow(/2 seats are in use/)
    await changeSeats(stripe, db, { teamId: t, userId: 'seat_owner', seats: 5 })
    const upd = requests.filter(r => r.method === 'POST' && /^\/subscriptions\/sub_/.test(r.path)).at(-1)!.params
    expect(upd).toMatchObject({ 'items[0][quantity]': '5', proration_behavior: 'create_prorations' })
    expect((await row(t))!.seat_count).toBe(5)
  })

  it('upgrade and downgrade change entitlements; portal and cancel-at-period-end work', async () => {
    const { stripe, requests } = fakeStripe()
    const t = await team('updown')
    await createInvoiceSubscription(stripe, db, { teamId: t, userId: 'updown', email: 'x@example.org', plan: 'pro', seats: 1, interval: 'month' })
    expect((await getEntitlements(db, 'updown')).tier).toBe('pro')
    await changePlan(stripe, db, { teamId: t, userId: 'updown', plan: 'reader', interval: 'month' })
    expect(await getEntitlements(db, 'updown')).toMatchObject({ tier: 'reader', reports: false, qa: false, max_watch_items: 10 })
    await changePlan(stripe, db, { teamId: t, userId: 'updown', plan: 'pro', interval: 'year' })
    expect(await getEntitlements(db, 'updown')).toMatchObject({ tier: 'pro', reports: true })
    expect((await row(t))!.billing_interval).toBe('year')
    expect(await createPortalSession(stripe, db, { teamId: t, userId: 'updown' })).toMatch(/^https:\/\//)
    await cancelAtPeriodEnd(stripe, db, { teamId: t, userId: 'updown' })
    expect(requests.at(-1)!.params).toMatchObject({ cancel_at_period_end: 'true' })
  })
})

describe('webhooks', () => {
  const sign = (event: object) => {
    const payload = JSON.stringify(event)
    return { payload, header: Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! }) }
  }
  const subEvent = (type: string, sub: object) => ({ id: `evt_${Math.random()}`, object: 'event', type, data: { object: sub } })

  it('checkout completion activates the team; the design-partner coupon sets the flag', async () => {
    const { stripe, subs } = fakeStripe()
    const t = await team('wh_owner')
    const s = await stripe.subscriptions.create({ customer: 'cus_x', items: [{ price: 'price_pro_y', quantity: 4 }], metadata: { team_id: t, coupon: 'design_partner' } })
    expect(subs.size).toBe(1)
    const r = await handleTeamBillingEvent(stripe, db, { type: 'checkout.session.completed', data: { object: { client_reference_id: `team:${t}`, subscription: s.id } } } as unknown as Stripe.Event)
    expect(r).toMatchObject({ handled: true, teamId: t })
    expect(await row(t)).toMatchObject({ plan: 'pro', seat_count: 4, subscription_status: 'active', is_design_partner: true, coupon_code: 'design_partner' })
  })

  it('signed webhook route: subscription update, payment failure, and cancellation change entitlements', async () => {
    setServiceDbForTests(db)
    const { POST } = await import('@/app/api/webhook/stripe/route')
    const t = await team('route_owner')
    const base = { id: 'sub_route', object: 'subscription', customer: 'cus_route', collection_method: 'charge_automatically', metadata: { team_id: t },
      items: { object: 'list', data: [{ id: 'si_1', quantity: 2, price: { id: 'price_pro_m' } }] } }
    const call = async (event: object, header?: string) => {
      const { payload, header: h } = sign(event)
      const req = new Request('http://x/api/webhook/stripe', { method: 'POST', body: payload, headers: { 'stripe-signature': header ?? h } })
      return POST(req as never)
    }
    expect((await call(subEvent('customer.subscription.updated', { ...base, status: 'active' }), 't=1,v1=forged')).status).toBe(400)
    expect((await call(subEvent('customer.subscription.updated', { ...base, status: 'active' }))).status).toBe(200)
    expect(await getEntitlements(db, 'route_owner')).toMatchObject({ tier: 'pro' })
    expect((await row(t))!.seat_count).toBe(2)
    await db.query(`update app.team set stripe_customer_id = 'cus_route' where id = $1`, [t])
    await call({ id: 'evt_pf', object: 'event', type: 'invoice.payment_failed', data: { object: { customer: 'cus_route' } } })
    expect((await row(t))!.subscription_status).toBe('past_due')
    expect((await getEntitlements(db, 'route_owner')).tier).toBe('free')
    await call(subEvent('customer.subscription.updated', { ...base, status: 'active' }))
    expect((await getEntitlements(db, 'route_owner')).tier).toBe('pro')
    await call(subEvent('customer.subscription.deleted', { ...base, status: 'canceled' }))
    expect((await row(t))!.subscription_status).toBe('canceled')
    expect(await getEntitlements(db, 'route_owner')).toMatchObject({ tier: 'free', reports: false, paid_content: false })
  })
})
