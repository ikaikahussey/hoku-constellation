import type { Metadata } from 'next'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { buttonClass } from '@/components/ui/Button'
import { verify } from '@/lib/crypto'

export const metadata: Metadata = { title: 'Unsubscribe', robots: { index: false } }

interface Props { searchParams: Promise<{ r?: string; s?: string; done?: string }> }

export default async function UnsubscribePage({ searchParams }: Props) {
  const { r = '', s = '', done } = await searchParams
  const valid = !done && /^[0-9a-f-]{36}$/i.test(r) && verify(`unsub:${r}`, s)
  return (
    <>
      <Header />
      <main className="flex-1 max-w-xl mx-auto w-full px-4 py-16">
        {done ? (
          <>
            <h1 className="text-3xl font-bold mb-4">Unsubscribed</h1>
            <p>You will no longer receive this alert. Your other alerts are unchanged.</p>
          </>
        ) : valid ? (
          <>
            <h1 className="text-3xl font-bold mb-4">Stop this alert?</h1>
            <p className="mb-6">You will stop receiving emails for this one alert rule. Other alerts are not affected.</p>
            <form method="post" action={`/api/alerts/unsubscribe?r=${encodeURIComponent(r)}&s=${encodeURIComponent(s)}`}>
              <button type="submit" className={buttonClass('primary')}>Unsubscribe</button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-bold mb-4">Link not valid</h1>
            <p>This unsubscribe link is not valid.</p>
          </>
        )}
        <p className="mt-8"><Link href="/account/alerts">Manage all alerts</Link></p>
      </main>
      <Footer />
    </>
  )
}
