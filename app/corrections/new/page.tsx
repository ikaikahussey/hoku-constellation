import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getServiceDb } from '@/lib/db/service'
import { submitCorrection } from '@/lib/corrections'
import { EVENTS } from '@/lib/analytics-events'
import { captureServerEvent } from '@/lib/analytics-server'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { buttonClass } from '@/components/ui/Button'

export const metadata: Metadata = { title: 'Report an error', robots: { index: false } }

interface Props { searchParams: Promise<{ entity?: string; document?: string; edge?: string; page?: string; done?: string; error?: string }> }

async function submit(fd: FormData) {
  'use server'
  const user = await getCurrentUser()
  const q = (k: string) => String(fd.get(k) ?? '')
  const back = new URLSearchParams({ entity: q('entity'), document: q('document'), page: q('page') })
  if (!user) redirect(`/auth/login?next=${encodeURIComponent(`/corrections/new?${back}`)}`)
  try {
    await submitCorrection(await getServiceDb(), { userId: user.id, email: user.email, entityId: q('entity') || null, documentId: q('document') || null, edgeId: q('edge') || null, pageUrl: q('page') || null, description: q('description') })
  } catch (e) {
    redirect(`/corrections/new?${back}&error=${encodeURIComponent((e as Error).message)}`)
  }
  await captureServerEvent(user.id, EVENTS.CORRECTION_SUBMITTED, { target: q('edge') ? 'edge' : q('document') ? 'document' : 'entity' })
  redirect(`/corrections/new?done=1&page=${encodeURIComponent(q('page'))}`)
}

export default async function NewCorrection({ searchParams }: Props) {
  const sp = await searchParams
  const user = await getCurrentUser()
  const db = await getServiceDb()
  const target = sp.entity && /^[0-9a-f-]{36}$/.test(sp.entity) ? (await db.one<{ name: string }>(`select name from entity where id = $1`, [sp.entity]))?.name
    : sp.document && /^[0-9a-f-]{36}$/.test(sp.document) ? (await db.one<{ title: string | null }>(`select title from document where id = $1`, [sp.document]))?.title : null
  return (
    <>
      <Header signedIn={!!user} />
      <main className="flex-1 max-w-xl mx-auto w-full px-4 py-12">
        <h1 className="text-3xl font-bold mb-4">Report an error</h1>
        {sp.done ? (
          <><p className="mb-4">Thank you. A HOKU Insider editor will acknowledge your report within one business day and correct the record if it is wrong.</p>{sp.page && <Link href={sp.page}>Back to the page</Link>}</>
        ) : !user ? (
          <p>Please <Link href={`/auth/login?next=${encodeURIComponent(`/corrections/new?${new URLSearchParams(sp as Record<string, string>)}`)}`}>log in</Link> to report an error, so we can follow up with you.</p>
        ) : (
          <form action={submit} className="space-y-4">
            {target && <p>About: <strong>{target}</strong></p>}
            {sp.error && <p role="alert">⚠ {sp.error}</p>}
            {['entity', 'document', 'edge', 'page'].map(k => <input key={k} type="hidden" name={k} value={(sp as Record<string, string | undefined>)[k] ?? ''} />)}
            <div><label htmlFor="description" className="block text-sm font-bold mb-1">What is wrong, and how do you know?</label>
              <textarea id="description" name="description" rows={6} required minLength={5} maxLength={5000} className="block w-full border border-ink p-3" placeholder="Include a link to the source that shows the correct information, if you have one." /></div>
            <button type="submit" className={buttonClass('primary')}>Submit</button>
          </form>
        )}
      </main>
      <Footer />
    </>
  )
}
