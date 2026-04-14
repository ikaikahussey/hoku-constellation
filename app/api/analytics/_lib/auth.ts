import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * Subscriber-gate analytics routes. Matches the RLS pattern from 012/015:
 * individual/professional/institutional tiers in active or trialing status,
 * OR a staff_role row.
 */
export async function authenticateSubscriber() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return {
      error: NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
      supabase,
      userId: null,
    }
  }

  const [{ data: profile }, { data: staff }] = await Promise.all([
    supabase.from('user_profile').select('subscription_tier, subscription_status').eq('id', user.id).maybeSingle(),
    supabase.from('staff_role').select('user_id').eq('user_id', user.id).maybeSingle(),
  ])

  const isStaff = !!staff
  const isSubscriber =
    profile &&
    ['individual', 'professional', 'institutional'].includes(profile.subscription_tier) &&
    ['active', 'trialing'].includes(profile.subscription_status)

  if (!isStaff && !isSubscriber) {
    return {
      error: NextResponse.json(
        { error: 'Subscription required' },
        { status: 403 }
      ),
      supabase,
      userId: user.id,
    }
  }
  return { error: null, supabase, userId: user.id }
}

/** Bearer CRON_SECRET auth for admin routes. */
export function authenticateCron(request: Request): Response | null {
  const header = request.headers.get('authorization')
  if (header !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
