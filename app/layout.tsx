import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Hoku Constellation — Mapping Hawaiʻi\'s Power Structure',
    template: '%s — Hoku Constellation',
  },
  description:
    'Hoku Constellation maps the people, money, and connections behind every major decision in Hawaiʻi. A searchable database of elected officials, lobbyists, donors, and organizations.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  openGraph: {
    siteName: 'Hoku Constellation',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
