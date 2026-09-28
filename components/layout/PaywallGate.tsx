'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { buttonClass } from '@/components/ui/Button'
import { track, EVENTS } from '@/lib/analytics-events'

interface PaywallGateProps {
  children: React.ReactNode
  hasAccess: boolean
  /** Where the gate is shown, e.g. "person_money" — sent with the paywall_shown event. */
  location?: string
  title?: string
  description?: string
}

export function PaywallGate({
  children,
  hasAccess,
  location = 'unknown',
  title = 'Subscribe to access',
  description = 'Full profiles, campaign finance detail, lobbying records, and relationship graphs are available to HOKU Insider subscribers.',
}: PaywallGateProps) {
  useEffect(() => {
    if (!hasAccess) track(EVENTS.PAYWALL_SHOWN, { location })
  }, [hasAccess, location])

  if (hasAccess) return <>{children}</>

  return (
    <div className="relative">
      <div className="blur-sm pointer-events-none select-none" aria-hidden="true">
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="bg-paper border border-ink p-8 max-w-md text-center">
          <h3 className="text-xl font-bold mb-2">{title}</h3>
          <p className="text-sm text-muted mb-5">{description}</p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/pricing" className={buttonClass('primary')}>View plans</Link>
            <Link href="/auth/login" className="text-sm">Log in</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
