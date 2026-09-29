/**
 * Team billing on Stripe (E6): seat-based subscriptions (quantity = seats), annual plans by default,
 * invoice billing (net 30) with PO numbers, coupons, prorated seat changes, customer portal, and the
 * webhook that turns Stripe state into team entitlements (app.team.plan / subscription_status).
 *
 * Test mode only from code. Live products/prices/coupons are created by the owner from the
 * checklist in docs/PRICING.md.
 */
import type Stripe from 'stripe'
import type { Db } from '@/lib/db/types'
import { getRole, getTeam, seatsUsed, type TeamRow } from '@/lib/teams'
import { PRICING, couponId, planForPrice, priceId, type Interval, type PaidPlan } from './plans'
import { SITE_URL } from '@/lib/site'

export class BillingError extends Error { constructor(message: string, public status = 400) { super(message) } }

const STATUS: Record<string, string> = {
  active: 'active', trialing: 'trialing', past_due: 'past_due', canceled: 'canceled', unpaid: 'canceled',
  incomplete: 'inactive', incomplete_expired: 'inactive', paused: 'inactive',
}

async function requireBillingAdmin(db: Db, teamId: string, userId: string): Promise<TeamRow> {
  const role = await getRole(db, teamId, userId)
  if (role !== 'owner' && role !== 'admin') throw new BillingError('Only the team owner or an admin can manage billing', 403)
  const team = await getTeam(db, teamId)
  if (!team) throw new BillingError('Team not found', 404)
  return team
}

function validateSeats(plan: PaidPlan, seats: number) {
  const cfg = PRICING.plans[plan]
  if (!Number.isInteger(seats) || seats < 1) throw new BillingError('Seats must be a positive whole number')
  if (!cfg.seatBased && seats !== 1) throw new BillingError(`${cfg.name} is a single-seat plan`)
  if (seats < cfg.minSeats) throw new BillingError(`${cfg.name} starts at ${cfg.minSeats} seats`)
}

function price(plan: PaidPlan, interval: Interval): string {
  const id = priceId(plan, interval)
  if (!id) throw new BillingError(`${PRICING.plans[plan].name} is not available ${interval === 'year' ? 'annually' : 'monthly'} (price not configured)`, 409)
  return id
}

async function ensureCustomer(stripe: Stripe, db: Db, team: TeamRow, email: string | null, poNumber?: string | null): Promise<string> {
  const fields = poNumber ? [{ name: 'PO number', value: poNumber.slice(0, 30) }] : undefined
  if (team.stripe_customer_id) {
    if (fields) await stripe.customers.update(team.stripe_customer_id, { invoice_settings: { custom_fields: fields } })
    return team.stripe_customer_id
  }
  const c = await stripe.customers.create({
    name: team.name, email: email ?? undefined, metadata: { team_id: team.id },
    invoice_settings: fields ? { custom_fields: fields } : undefined,
  })
  await db.query(`update app.team set stripe_customer_id = $2 where id = $1`, [team.id, c.id])
  return c.id
}

export interface CheckoutArgs { teamId: string; userId: string; email: string | null; plan: PaidPlan; interval?: Interval; seats: number; coupon?: string | null }

/** Card checkout (Stripe Checkout, subscription mode). Returns the hosted checkout URL. */
export async function createCheckout(stripe: Stripe, db: Db, a: CheckoutArgs): Promise<{ url: string; id: string }> {
  const team = await requireBillingAdmin(db, a.teamId, a.userId)
  const interval = a.interval ?? PRICING.defaultInterval
  validateSeats(a.plan, a.seats)
  if (PRICING.plans[a.plan].custom) throw new BillingError('Organization plans are set up with invoice billing; contact us or use invoice billing', 409)
  if (team.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(team.subscription_status)) {
    throw new BillingError('This team already has a subscription; change seats or plan from billing settings', 409)
  }
  const customer = await ensureCustomer(stripe, db, team, a.email)
  const coupon = a.coupon ? couponId(a.coupon) : null
  if (a.coupon && !coupon) throw new BillingError('Unknown or unavailable coupon')
  const metadata = { team_id: team.id, plan: a.plan, coupon: a.coupon ?? '' }
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription', customer, client_reference_id: `team:${team.id}`,
    line_items: [{ price: price(a.plan, interval), quantity: a.seats }],
    discounts: coupon ? [{ coupon }] : undefined,
    allow_promotion_codes: coupon ? undefined : true,
    subscription_data: { metadata },
    metadata,
    success_url: `${SITE_URL}/workspace/billing?checkout=success`,
    cancel_url: `${SITE_URL}/pricing?checkout=cancelled`,
  })
  return { url: session.url!, id: session.id }
}

export interface InvoiceArgs extends Omit<CheckoutArgs, 'email'> { email: string; poNumber?: string | null }

/**
 * Invoice billing (net 30) via Stripe Invoicing: the subscription is created directly with
 * collection_method=send_invoice; the PO number is printed on every invoice as a custom field.
 */
export async function createInvoiceSubscription(stripe: Stripe, db: Db, a: InvoiceArgs): Promise<{ subscriptionId: string }> {
  const team = await requireBillingAdmin(db, a.teamId, a.userId)
  const interval = a.interval ?? PRICING.defaultInterval
  validateSeats(a.plan, a.seats)
  if (a.plan === 'reader') throw new BillingError('Invoice billing is available on Pro and Organization plans')
  if (team.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(team.subscription_status)) throw new BillingError('This team already has a subscription', 409)
  const customer = await ensureCustomer(stripe, db, team, a.email, a.poNumber)
  const coupon = a.coupon ? couponId(a.coupon) : null
  if (a.coupon && !coupon) throw new BillingError('Unknown or unavailable coupon')
  const sub = await stripe.subscriptions.create({
    customer, collection_method: 'send_invoice', days_until_due: PRICING.invoice.daysUntilDue,
    items: [{ price: price(a.plan, interval), quantity: a.seats }],
    discounts: coupon ? [{ coupon }] : undefined,
    metadata: { team_id: team.id, plan: a.plan, coupon: a.coupon ?? '', po_number: a.poNumber ?? '' },
  })
  await db.query(`update app.team set collection_method = 'send_invoice', po_number = $2 where id = $1`, [team.id, a.poNumber ?? null])
  await syncTeamFromSubscription(db, sub)
  return { subscriptionId: sub.id }
}

/** Change seat count; Stripe prorates the difference on the next invoice. */
export async function changeSeats(stripe: Stripe, db: Db, a: { teamId: string; userId: string; seats: number }): Promise<void> {
  const team = await requireBillingAdmin(db, a.teamId, a.userId)
  if (!team.stripe_subscription_id) throw new BillingError('No subscription to change', 409)
  validateSeats(team.plan === 'free' ? 'pro' : team.plan, a.seats)
  const used = await seatsUsed(db, a.teamId)
  if (a.seats < used) throw new BillingError(`${used} seats are in use (members and pending invitations); remove members first`, 409)
  const sub = await stripe.subscriptions.retrieve(team.stripe_subscription_id)
  const item = sub.items.data[0]
  const updated = await stripe.subscriptions.update(sub.id, {
    items: [{ id: item.id, quantity: a.seats }], proration_behavior: 'create_prorations',
  })
  await syncTeamFromSubscription(db, updated)
}

/** Switch plan or interval (upgrade/downgrade), prorated. */
export async function changePlan(stripe: Stripe, db: Db, a: { teamId: string; userId: string; plan: PaidPlan; interval: Interval }): Promise<void> {
  const team = await requireBillingAdmin(db, a.teamId, a.userId)
  if (!team.stripe_subscription_id) throw new BillingError('No subscription to change', 409)
  validateSeats(a.plan, a.plan === 'reader' ? 1 : Math.max(team.seat_count, PRICING.plans[a.plan].minSeats))
  if (a.plan === 'reader' && (await seatsUsed(db, a.teamId)) > 1) throw new BillingError('Reader is single-seat; remove other members first', 409)
  const sub = await stripe.subscriptions.retrieve(team.stripe_subscription_id)
  const updated = await stripe.subscriptions.update(sub.id, {
    items: [{ id: sub.items.data[0].id, price: price(a.plan, a.interval), quantity: a.plan === 'reader' ? 1 : Math.max(team.seat_count, PRICING.plans[a.plan].minSeats) }],
    proration_behavior: 'create_prorations', metadata: { ...sub.metadata, plan: a.plan },
  })
  await syncTeamFromSubscription(db, updated)
}

export async function cancelAtPeriodEnd(stripe: Stripe, db: Db, a: { teamId: string; userId: string }): Promise<void> {
  const team = await requireBillingAdmin(db, a.teamId, a.userId)
  if (!team.stripe_subscription_id) throw new BillingError('No subscription to cancel', 409)
  await stripe.subscriptions.update(team.stripe_subscription_id, { cancel_at_period_end: true })
}

export async function createPortalSession(stripe: Stripe, db: Db, a: { teamId: string; userId: string }): Promise<string> {
  const team = await requireBillingAdmin(db, a.teamId, a.userId)
  if (!team.stripe_customer_id) throw new BillingError('No billing account yet', 409)
  const s = await stripe.billingPortal.sessions.create({ customer: team.stripe_customer_id, return_url: `${SITE_URL}/workspace/billing` })
  return s.url
}

// ------------------------------------------------------------------------------------------------ webhook

/** Write a subscription's plan, status, seats, and interval onto its team. Returns the team id. */
export async function syncTeamFromSubscription(db: Db, sub: Stripe.Subscription): Promise<string | null> {
  const item = sub.items?.data?.[0]
  const mapped = planForPrice(item?.price?.id)
  const teamId = sub.metadata?.team_id
    ?? (await db.one<{ id: string }>(`select id from app.team where stripe_subscription_id = $1 or stripe_customer_id = $2`, [sub.id, typeof sub.customer === 'string' ? sub.customer : sub.customer?.id]))?.id
  if (!teamId) return null
  const status = STATUS[sub.status] ?? 'inactive'
  const couponKey = sub.metadata?.coupon || null
  await db.query(
    `update app.team set
       plan = coalesce($2, plan), subscription_status = $3, seat_count = greatest(1, coalesce($4, seat_count)),
       billing_interval = coalesce($5, billing_interval), collection_method = $6,
       stripe_subscription_id = $7, stripe_customer_id = coalesce($8, stripe_customer_id),
       coupon_code = coalesce(nullif($9, ''), coupon_code),
       is_design_partner = is_design_partner or coalesce($9 = 'design_partner', false)
     where id = $1`,
    [teamId, mapped?.plan ?? null, status, item?.quantity ?? null, mapped?.interval ?? null, sub.collection_method ?? 'charge_automatically',
      sub.id, typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null, couponKey])
  return teamId
}

export interface WebhookOutcome { handled: boolean; teamId?: string | null; event: string }

/** Team-level Stripe events. Legacy individual subscriptions are handled by the caller. */
export async function handleTeamBillingEvent(stripe: Stripe, db: Db, event: Stripe.Event): Promise<WebhookOutcome> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object as Stripe.Checkout.Session
      if (!s.client_reference_id?.startsWith('team:') || !s.subscription) return { handled: false, event: event.type }
      const sub = await stripe.subscriptions.retrieve(typeof s.subscription === 'string' ? s.subscription : s.subscription.id)
      return { handled: true, teamId: await syncTeamFromSubscription(db, sub), event: event.type }
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      if (!sub.metadata?.team_id && !(await db.one(`select 1 from app.team where stripe_subscription_id = $1`, [sub.id]))) return { handled: false, event: event.type }
      if (event.type === 'customer.subscription.deleted') sub.status = 'canceled'
      return { handled: true, teamId: await syncTeamFromSubscription(db, sub), event: event.type }
    }
    case 'invoice.payment_failed': {
      const inv = event.data.object as Stripe.Invoice
      const customer = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id
      const r = await db.query(`update app.team set subscription_status = 'past_due' where stripe_customer_id = $1 and subscription_status = 'active'`, [customer])
      return { handled: r.rowCount > 0, event: event.type }
    }
    default:
      return { handled: false, event: event.type }
  }
}
