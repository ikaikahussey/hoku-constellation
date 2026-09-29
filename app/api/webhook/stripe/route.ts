import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getServiceDb } from '@/lib/db/service'
import { updateUserAccountByUserId, updateUserAccountByStripeCustomer, getUserAccountByStripeCustomer } from '@/lib/db/queries/accounts'
import { EVENTS } from '@/lib/analytics-events'
import { captureServerEvent } from '@/lib/analytics-server'
import type { UserAccountRow } from '@/lib/db/types'
import { handleTeamBillingEvent } from '@/lib/billing'

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2026-08-26.dahlia' })
}

export function tierFromPriceId(priceId: string | undefined): UserAccountRow['subscription_tier'] {
  if (!priceId) return 'free'
  const individual = [process.env.STRIPE_PRICE_INDIVIDUAL_MONTHLY, process.env.STRIPE_PRICE_INDIVIDUAL_YEARLY]
  const professional = [process.env.STRIPE_PRICE_PROFESSIONAL_MONTHLY, process.env.STRIPE_PRICE_PROFESSIONAL_YEARLY]
  if (individual.includes(priceId)) return 'individual'
  if (professional.includes(priceId)) return 'professional'
  return 'free'
}

const STATUS_MAP: Record<string, string> = {
  active: 'active', trialing: 'trialing', past_due: 'past_due', canceled: 'canceled', unpaid: 'canceled',
  incomplete: 'inactive', incomplete_expired: 'inactive', paused: 'inactive',
}

/**
 * Stripe webhook. Users are resolved via user_account (client_reference_id = Neon Auth user id on
 * checkout; stripe_customer_id thereafter). Emits server-side PostHog events.
 */
export async function POST(request: NextRequest) {
  const stripe = getStripe()
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || ''
  const body = await request.text()
  const signature = request.headers.get('stripe-signature') ?? ''

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const db = await getServiceDb()

  // Team subscriptions (E6) drive app.team and therefore app.entitlements().
  const team = await handleTeamBillingEvent(stripe, db, event)
  if (team.handled) {
    if (event.type === 'checkout.session.completed' && team.teamId) {
      const session = event.data.object as Stripe.Checkout.Session
      const owner = await db.one<{ user_id: string }>(`select user_id from app.team_member where team_id = $1 and role = 'owner'`, [team.teamId])
      if (owner) await captureServerEvent(owner.user_id, EVENTS.CHECKOUT_COMPLETED, { tier: String(session.metadata?.plan ?? 'pro'), amount: (session.amount_total ?? 0) / 100, currency: session.currency ?? 'usd' })
    }
    return NextResponse.json({ received: true, team: team.teamId ?? null })
  }

  // Legacy individual subscriptions (user_account), kept until those customers move to teams.
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      if (session.subscription && session.client_reference_id) {
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string)
        const priceId = subscription.items.data[0]?.price.id
        const tier = tierFromPriceId(priceId)
        await updateUserAccountByUserId(db, session.client_reference_id, {
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: session.subscription as string,
          subscription_tier: tier,
          subscription_status: STATUS_MAP[subscription.status] ?? 'active',
          trial_ends_at: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
        })
        await captureServerEvent(session.client_reference_id, EVENTS.CHECKOUT_COMPLETED, {
          tier, amount: (session.amount_total ?? 0) / 100, currency: session.currency ?? 'usd',
        })
      }
      break
    }
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription
      const customerId = subscription.customer as string
      const tier = tierFromPriceId(subscription.items.data[0]?.price.id)
      await updateUserAccountByStripeCustomer(db, customerId, {
        subscription_tier: tier,
        subscription_status: STATUS_MAP[subscription.status] ?? 'inactive',
        stripe_subscription_id: subscription.id,
        trial_ends_at: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
      })
      break
    }
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription
      const customerId = subscription.customer as string
      const account = await getUserAccountByStripeCustomer(db, customerId)
      await updateUserAccountByStripeCustomer(db, customerId, { subscription_tier: 'free', subscription_status: 'canceled' })
      if (account) {
        await captureServerEvent(account.user_id, EVENTS.SUBSCRIPTION_CANCELLED, { previous_tier: account.subscription_tier })
      }
      break
    }
  }

  return NextResponse.json({ received: true })
}
