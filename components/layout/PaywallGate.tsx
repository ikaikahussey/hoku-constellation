import Link from 'next/link'

interface PaywallGateProps {
  children: React.ReactNode
  hasAccess: boolean
}

export function PaywallGate({ children, hasAccess }: PaywallGateProps) {
  if (hasAccess) return <>{children}</>

  return (
    <div className="relative">
      <div className="blur-sm pointer-events-none select-none" aria-hidden="true">
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-navy/60">
        <div className="text-center p-8 max-w-md">
          <div className="w-12 h-12 rounded-full bg-gold/20 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">Subscribe to access</h3>
          <p className="text-sm text-white/50 mb-4">
            Full profiles, campaign finance detail, relationship maps, and more are available to Hoku Constellation subscribers.
          </p>
          <Link
            href="/pricing"
            className="inline-flex items-center bg-gold text-navy px-6 py-2.5 rounded-md font-semibold text-sm hover:bg-gold-light transition-colors"
          >
            View Plans
          </Link>
        </div>
      </div>
    </div>
  )
}
