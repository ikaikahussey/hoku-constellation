import { createClient } from '@/lib/supabase/server'

export type SubscriptionTier = 'free' | 'individual' | 'professional' | 'institutional'

export interface UserWithProfile {
  id: string
  email: string
  profile: {
    full_name: string | null
    subscription_tier: SubscriptionTier
    subscription_status: string
    trial_ends_at: string | null
  } | null
  isStaff: boolean
  staffRole: string | null
}

export async function getCurrentUser(): Promise<UserWithProfile | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  const [profileResult, staffResult] = await Promise.all([
    supabase.from('user_profile').select('*').eq('id', user.id).single(),
    supabase.from('staff_role').select('role').eq('user_id', user.id).single(),
  ])

  return {
    id: user.id,
    email: user.email || '',
    profile: profileResult.data,
    isStaff: !!staffResult.data,
    staffRole: staffResult.data?.role || null,
  }
}

export function canAccessGatedContent(tier: SubscriptionTier | undefined, status: string | undefined): boolean {
  if (!tier || !status) return false
  return ['individual', 'professional', 'institutional'].includes(tier) &&
    ['active', 'trialing'].includes(status)
}

export function canAccessApi(tier: SubscriptionTier | undefined): boolean {
  return tier === 'professional' || tier === 'institutional'
}

export function canExportCsv(tier: SubscriptionTier | undefined): boolean {
  return tier === 'professional' || tier === 'institutional'
}
