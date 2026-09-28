import type { Metadata } from 'next'
import './globals.css'
import { Providers, type AnalyticsIdentity } from './providers'
import { getCurrentUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: {
    default: 'HOKU Insider — Mapping Hawaiʻi’s power structure',
    template: '%s — HOKU Insider',
  },
  description:
    'HOKU Insider maps the people, money, and connections behind every major decision in Hawaiʻi. A searchable database of elected officials, lobbyists, donors, and organizations.',
  metadataBase: new URL((process.env.NEXT_PUBLIC_SITE_URL || 'https://constellation.hoku.fm').trim()),
  icons: '/icon.svg',
  openGraph: {
    siteName: 'HOKU Insider',
    type: 'website',
  },
}

async function getIdentity(): Promise<AnalyticsIdentity | null> {
  try {
    const user = await getCurrentUser()
    if (!user) return null
    return {
      userId: user.id,
      subscription_tier: user.account.subscription_tier,
      is_staff: user.account.is_staff,
      signup_date: user.account.created_at,
    }
  } catch {
    return null
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const identity = await getIdentity()
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-paper text-ink">
        <Providers identity={identity}>{children}</Providers>
      </body>
    </html>
  )
}
