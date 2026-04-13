'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import Link from 'next/link'

interface Profile {
  subscription_tier: string
  subscription_status: string
  email: string | null
  full_name: string | null
  trial_ends_at: string | null
}

export default function AccountPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data } = await supabase
        .from('user_profile')
        .select('subscription_tier, subscription_status, email, full_name, trial_ends_at')
        .eq('id', user.id)
        .single()

      setProfile(data || {
        subscription_tier: 'free',
        subscription_status: 'inactive',
        email: user.email || null,
        full_name: null,
        trial_ends_at: null,
      })
      setLoading(false)
    }
    load()
  }, [])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  if (loading) {
    return (
      <>
        <Header />
        <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-16">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-white/10 rounded w-48" />
            <div className="h-32 bg-white/10 rounded" />
          </div>
        </main>
        <Footer />
      </>
    )
  }

  if (!profile) {
    return (
      <>
        <Header />
        <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-16 text-center">
          <p className="text-white/50">Please log in to view your account.</p>
          <Link href="/auth/login" className="text-gold mt-4 inline-block">Log in</Link>
        </main>
        <Footer />
      </>
    )
  }

  return (
    <>
      <Header />
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 sm:px-6 py-16">
        <h1 className="text-2xl font-bold text-white mb-8">Account</h1>

        <div className="bg-navy-light rounded-lg border border-white/10 p-6 mb-6">
          <h2 className="text-lg font-semibold text-white mb-4">Profile</h2>
          <div className="space-y-2 text-sm">
            <p><span className="text-white/50">Email:</span> <span className="text-white">{profile.email}</span></p>
            {profile.full_name && (
              <p><span className="text-white/50">Name:</span> <span className="text-white">{profile.full_name}</span></p>
            )}
          </div>
        </div>

        <div className="bg-navy-light rounded-lg border border-white/10 p-6 mb-6">
          <h2 className="text-lg font-semibold text-white mb-4">Subscription</h2>
          <div className="space-y-2 text-sm">
            <p>
              <span className="text-white/50">Plan:</span>{' '}
              <span className="text-gold font-medium capitalize">{profile.subscription_tier}</span>
            </p>
            <p>
              <span className="text-white/50">Status:</span>{' '}
              <span className={`font-medium ${profile.subscription_status === 'active' ? 'text-green-400' : 'text-white/60'}`}>
                {profile.subscription_status}
              </span>
            </p>
            {profile.trial_ends_at && (
              <p>
                <span className="text-white/50">Trial ends:</span>{' '}
                <span className="text-white">{new Date(profile.trial_ends_at).toLocaleDateString()}</span>
              </p>
            )}
          </div>

          {profile.subscription_tier === 'free' && (
            <Link
              href="/pricing"
              className="inline-block mt-4 bg-gold text-navy px-4 py-2 rounded-md text-sm font-semibold hover:bg-gold-light transition-colors"
            >
              Upgrade
            </Link>
          )}
        </div>

        <button
          onClick={handleSignOut}
          className="text-sm text-white/40 hover:text-white transition-colors"
        >
          Sign out
        </button>
      </main>
      <Footer />
    </>
  )
}
