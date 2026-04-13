import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/admin'

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2026-03-25.dahlia',
  })
}

function tierFromPriceId(priceId: string): string {
  const individual = [
    process.env.STRIPE_PRICE_INDIVIDUAL_MONTHLY,
    process.env.STRIPE_PRICE_INDIVIDUAL_YEARLY,
  ]
  const professional = [
    process.env.STRIPE_PRICE_PROFESSIONAL_MONTHLY,
    process.env.STRIPE_PRICE_PROFESSIONAL_YEARLY,
  ]

  if (individual.includes(priceId)) return 'individual'
  if (professional.includes(priceId)) return 'professional'
  return 'free'
}

export async function POST(request: NextRequest) {
  const stripe = getStripe()
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || ''
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')!

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = createAdminClient()

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      if (session.subscription && session.client_reference_id) {
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string)
        const priceId = subscription.items.data[0]?.price.id
        const tier = tierFromPriceId(priceId)

        await supabase.from('user_profile').upsert({
          id: session.client_reference_id,
          email: session.customer_email,
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: session.subscription as string,
          subscription_tier: tier,
          subscription_status: 'active',
        })
      }
      break
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription
      const customerId = subscription.customer as string
      const priceId = subscription.items.data[0]?.price.id
      const tier = tierFromPriceId(priceId)

      const statusMap: Record<string, string> = {
        active: 'active',
        trialing: 'trialing',
        past_due: 'past_due',
        canceled: 'canceled',
        unpaid: 'canceled',
      }

      await supabase
        .from('user_profile')
        .update({
          subscription_tier: tier,
          subscription_status: statusMap[subscription.status] || 'inactive',
          trial_ends_at: subscription.trial_end
            ? new Date(subscription.trial_end * 1000).toISOString()
            : null,
        })
        .eq('stripe_customer_id', customerId)
      break
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription
      const customerId = subscription.customer as string

      await supabase
        .from('user_profile')
        .update({
          subscription_tier: 'free',
          subscription_status: 'canceled',
        })
        .eq('stripe_customer_id', customerId)
      break
    }
  }

  return NextResponse.json({ received: true })
}
