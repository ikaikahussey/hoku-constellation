'use client'

import { useEffect, type ReactNode } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { identifyUser, resetAnalytics } from '@/lib/analytics-events'

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const RECORDING_EXCLUDED = [/^\/admin(\/|$)/, /^\/auth(\/|$)/]

let initialized = false
function initPostHog() {
  if (initialized || typeof window === 'undefined' || !KEY) return
  posthog.init(KEY, {
    // Reverse-proxied through next.config.ts rewrites so ad blockers do not drop events.
    api_host: '/ingest',
    ui_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.posthog.com',
    capture_pageview: false, // captured manually on App Router navigations below
    capture_pageleave: true,
    respect_dnt: true,
    persistence: 'localStorage+cookie',
    autocapture: false,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '[data-ph-mask]',
      blockSelector: '[data-ph-mask]',
    },
    loaded: ph => {
      ;(window as unknown as { posthog: unknown }).posthog = ph
    },
  })
  initialized = true
}

function PageviewTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  useEffect(() => {
    if (!KEY || !pathname) return
    const excluded = RECORDING_EXCLUDED.some(re => re.test(pathname))
    if (excluded) posthog.stopSessionRecording()
    else posthog.startSessionRecording()
    // Query strings are dropped from the URL so search terms never reach analytics.
    posthog.capture('$pageview', { $current_url: `${window.location.origin}${pathname}`, has_query: searchParams.toString().length > 0 })
  }, [pathname, searchParams])
  return null
}

export interface AnalyticsIdentity {
  userId: string
  subscription_tier: string
  is_staff: boolean
  signup_date: string
}

/** Identifies the signed-in user (no email/name) or resets on sign-out. */
function IdentitySync({ identity }: { identity: AnalyticsIdentity | null }) {
  useEffect(() => {
    if (!KEY) return
    if (identity) {
      identifyUser(identity.userId, { subscription_tier: identity.subscription_tier, is_staff: identity.is_staff, signup_date: identity.signup_date })
    } else if (posthog.__loaded && posthog._isIdentified()) {
      resetAnalytics()
    }
  }, [identity])
  return null
}

export function Providers({ children, identity = null }: { children: ReactNode; identity?: AnalyticsIdentity | null }) {
  initPostHog()
  if (!KEY) return <>{children}<SpeedInsights /></>
  return (
    <PostHogProvider client={posthog}>
      <PageviewTracker />
      <IdentitySync identity={identity} />
      {children}
      <SpeedInsights />
    </PostHogProvider>
  )
}
