import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getServiceDb } from '@/lib/db/service'
import { getEntity, getEdges } from '@/lib/db/queries'
import type { EdgeWithEnds } from '@/lib/db/queries/edges'
import { getCurrentUser } from '@/lib/auth'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { PaywallGate } from '@/components/layout/PaywallGate'
import { TrackEntityView } from '@/components/profile/TrackEntityView'
import { Badge } from '@/components/ui/Badge'
import { attr, otherEnd } from '@/components/profile/edges'
import { formatShortDate } from '@/lib/format'

export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ id: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function loadBill(id: string) {
  if (!UUID.test(id)) return null
  const db = await getServiceDb()
  const bill = await getEntity(db, id)
  return bill && bill.kind === 'bill' ? bill : null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const bill = await loadBill(id)
  if (!bill) return { title: 'Not found' }
  const measure = attr(bill, 'measure_number')
  const title = measure ? `${measure} — ${bill.name}` : bill.name
  return { title, description: `${title} on HOKU Insider: sponsors, votes, and testimony.` }
}

function PartyList({ edges, billId, showDate = false, emptyMessage }: { edges: EdgeWithEnds[]; billId: string; showDate?: boolean; emptyMessage: string }) {
  if (edges.length === 0) return <p className="text-sm text-muted py-2">{emptyMessage}</p>
  return (
    <ul className="divide-y divide-rule">
      {edges.map(edge => {
        const other = otherEnd(edge, billId)
        const committee = typeof edge.attributes?.committee === 'string' ? edge.attributes.committee : null
        return (
          <li key={edge.id} className="py-2 flex items-start justify-between gap-4">
            <div>
              <span className="font-bold">{other.href ? <Link href={other.href} className="link-quiet">{other.name}</Link> : other.name}</span>
              {edge.role && <span className="ml-2 text-sm text-muted">{edge.role}</span>}
              {committee && <span className="ml-2 text-sm text-muted">· {committee}</span>}
            </div>
            <div className="text-xs text-muted text-right flex-shrink-0 tabular">
              {showDate && edge.start_date && <div>{formatShortDate(edge.start_date)}</div>}
              {edge.doc_url ? <a href={edge.doc_url} target="_blank" rel="noopener noreferrer">{edge.doc_source.replace(/_/g, ' ')}</a> : <div>{edge.doc_source.replace(/_/g, ' ')}</div>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

const PLACEHOLDER_TESTIMONY = (position: string, n: number): EdgeWithEnds[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `placeholder-${position}-${i}`, type: 'testified_on', from_id: null, to_id: null,
    from_name_raw: 'Subscriber-only testifier', to_name_raw: null, role: position, amount: null,
    start_date: null, end_date: null, document_id: '', match_status: 'matched', match_confidence: null, attributes: {},
    from_name: null, from_kind: null, from_slug: null, to_name: null, to_kind: null, to_slug: null,
    doc_source: 'capitol', doc_type: 'testimony', doc_title: null, doc_url: null, doc_date: null,
  }))

export default async function BillPage({ params }: Props) {
  const { id } = await params
  const bill = await loadBill(id)
  if (!bill) notFound()

  const db = await getServiceDb()
  const user = await getCurrentUser()
  const hasAccess = !!user?.canAccessGated

  const [sponsors, votes, testimony] = await Promise.all([
    getEdges(db, bill.id, { types: ['sponsored'], direction: 'in', limit: 200 }),
    getEdges(db, bill.id, { types: ['voted_on'], direction: 'in', limit: 500 }),
    hasAccess ? getEdges(db, bill.id, { types: ['testified_on'], direction: 'in', limit: 1000 }) : Promise.resolve([] as EdgeWithEnds[]),
  ])

  const measure = attr(bill, 'measure_number')
  const session = attr(bill, 'session')
  const status = attr(bill, 'status')
  const description = attr(bill, 'description')
  const url = attr(bill, 'url')

  const byPosition = (p: string) => testimony.filter(t => (t.role ?? '').toLowerCase() === p)
  const positions: Array<{ key: string; label: string }> = [
    { key: 'support', label: 'In support' },
    { key: 'oppose', label: 'In opposition' },
    { key: 'comment', label: 'Comments only' },
  ]
  const uncategorized = testimony.filter(t => !positions.some(p => (t.role ?? '').toLowerCase() === p.key))

  return (
    <>
      <Header signedIn={!!user} />
      <TrackEntityView kind="bill" id={bill.id} gateHit={!hasAccess} />
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <header className="mb-10 pb-8 border-b border-ink">
          <p className="text-xs text-muted uppercase tracking-wide mb-1">Bill{session ? ` · ${session} session` : ''}</p>
          <h1 className="text-3xl sm:text-4xl font-bold">
            {measure && <span className="tabular">{measure}: </span>}{bill.name}
          </h1>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {status && <Badge variant="outline">{status.replace(/_/g, ' ')}</Badge>}
            {session && <Badge variant="muted">{session}</Badge>}
          </div>
          {description && <p className="mt-4 text-muted max-w-3xl">{description}</p>}
          {url && <p className="mt-3 text-sm"><a href={url} target="_blank" rel="noopener noreferrer">View on the Legislature&apos;s website</a></p>}
        </header>

        <section className="mb-10">
          <h2 className="text-xl font-bold mb-3">Sponsors <span className="text-muted font-normal text-base tabular">({sponsors.length})</span></h2>
          <PartyList edges={sponsors} billId={bill.id} showDate emptyMessage="No sponsors recorded." />
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-bold mb-3">Votes <span className="text-muted font-normal text-base tabular">({votes.length})</span></h2>
          <PartyList edges={votes} billId={bill.id} showDate emptyMessage="No recorded votes." />
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-bold mb-3">Testimony{hasAccess && <span className="text-muted font-normal text-base tabular"> ({testimony.length})</span>}</h2>
          <PaywallGate hasAccess={hasAccess} location="bill_testimony" description="Who testified for and against this measure, with links to the filed testimony, is available to HOKU Insider subscribers.">
            <div className="space-y-8">
              {positions.map(p => {
                const list = hasAccess ? byPosition(p.key) : PLACEHOLDER_TESTIMONY(p.key, 3)
                return (
                  <div key={p.key}>
                    <h3 className="text-xs font-bold uppercase tracking-wide mb-2 pb-1 border-b border-ink">
                      {p.label} <span className="text-muted font-normal tabular">({list.length})</span>
                    </h3>
                    <PartyList edges={list} billId={bill.id} showDate emptyMessage={`No testimony ${p.key === 'comment' ? 'with comments only' : p.label.toLowerCase()}.`} />
                  </div>
                )
              })}
              {hasAccess && uncategorized.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wide mb-2 pb-1 border-b border-ink">Position not stated <span className="text-muted font-normal tabular">({uncategorized.length})</span></h3>
                  <PartyList edges={uncategorized} billId={bill.id} showDate emptyMessage="" />
                </div>
              )}
            </div>
          </PaywallGate>
        </section>
      </main>
      <Footer />
    </>
  )
}
