import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getServiceDb } from '@/lib/db/service'
import { getDocument, getEdgesForDocument } from '@/lib/db/queries'
import type { EdgeWithEnds } from '@/lib/db/queries/edges'
import { PAID_DOC_TYPES } from '@/lib/db/gating'
import { getCurrentUser } from '@/lib/auth'
import { formatDate, formatCurrency } from '@/lib/format'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { PaywallGate } from '@/components/layout/PaywallGate'
import { Badge } from '@/components/ui/Badge'
import { entityHref } from '@/components/search/EntityCard'
import { documentTitle } from '@/components/documents/DocumentTable'
import { docTypeLabel, sourceLabel, sourceTitle } from '@/components/documents/labels'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BODY_LIMIT = 20_000

interface Props { params: Promise<{ id: string }> }

async function load(id: string) {
  if (!UUID.test(id)) return null
  const db = await getServiceDb()
  return getDocument(db, id)
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const doc = await load(id)
  if (!doc) return { title: 'Not found' }
  const title = documentTitle(doc)
  return { title: `${title} — Documents`, description: `${docTypeLabel(doc.doc_type)} from ${sourceLabel(doc.source)}${doc.doc_date ? `, ${formatDate(doc.doc_date)}` : ''}.` }
}

function EndLink({ name, kind, slug, id, raw }: { name: string | null; kind: string | null; slug: string | null; id: string | null; raw: string | null }) {
  const href = id ? entityHref(kind, slug, id) : null
  const label = name ?? raw ?? '—'
  return href ? <Link href={href} className="link-quiet font-bold">{label}</Link> : <span className={name ? 'font-bold' : 'text-muted'}>{label}</span>
}

function EdgeList({ edges }: { edges: EdgeWithEnds[] }) {
  if (edges.length === 0) return <p className="text-muted text-sm">No relationships have been drawn from this document yet.</p>
  return (
    <ul className="divide-y divide-rule">
      {edges.map(e => (
        <li key={e.id} className="py-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
          <EndLink name={e.from_name} kind={e.from_kind} slug={e.from_slug} id={e.from_id} raw={e.from_name_raw} />
          <span className="text-muted">{e.type.replace(/_/g, ' ')}</span>
          <EndLink name={e.to_name} kind={e.to_kind} slug={e.to_slug} id={e.to_id} raw={e.to_name_raw} />
          {e.role && <span className="text-muted">· {e.role}</span>}
          {e.amount != null && <span className="tabular ml-auto">{formatCurrency(Number(e.amount))}</span>}
          {e.match_status !== 'matched' && <Badge variant="muted">{e.match_status}</Badge>}
        </li>
      ))}
    </ul>
  )
}

export default async function DocumentPage({ params }: Props) {
  const { id } = await params
  const doc = await load(id)
  if (!doc) notFound()

  const [db, user] = await Promise.all([getServiceDb(), getCurrentUser()])
  const gated = PAID_DOC_TYPES.has(doc.doc_type)
  const hasAccess = !gated || !!user?.canAccessGated
  const edges = hasAccess ? await getEdgesForDocument(db, doc.id) : []
  const body = doc.body_text?.trim() ?? ''
  const rawJson = JSON.stringify(doc.raw, null, 2)

  return (
    <>
      <Header signedIn={!!user} />
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <nav aria-label="Breadcrumb" className="text-sm text-muted mb-4">
          <Link href="/documents" className="link-quiet">Documents</Link>
          <span aria-hidden="true" className="mx-2">/</span>
          <Link href={`/documents?source=${encodeURIComponent(doc.source)}`} className="link-quiet">{sourceLabel(doc.source)}</Link>
        </nav>

        <header className="mb-8 pb-6 border-b border-ink">
          <p className="text-xs text-muted uppercase tracking-wide mb-1">{docTypeLabel(doc.doc_type)}</p>
          <h1 className="text-3xl font-bold">{documentTitle(doc)}</h1>
          <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <div className="flex gap-2"><dt className="text-muted w-28 flex-shrink-0">Source</dt><dd title={sourceTitle(doc.source)}>{sourceLabel(doc.source)}</dd></div>
            <div className="flex gap-2"><dt className="text-muted w-28 flex-shrink-0">Document date</dt><dd className="tabular">{doc.doc_date ? formatDate(doc.doc_date) : '—'}</dd></div>
            {doc.source_record_id && <div className="flex gap-2"><dt className="text-muted w-28 flex-shrink-0">Record id</dt><dd className="tabular break-all">{doc.source_record_id}</dd></div>}
            <div className="flex gap-2"><dt className="text-muted w-28 flex-shrink-0">Fetched</dt><dd className="tabular">{formatDate(doc.fetched_at)}</dd></div>
            {doc.url && <div className="flex gap-2 sm:col-span-2"><dt className="text-muted w-28 flex-shrink-0">Original</dt><dd className="break-all"><a href={doc.url} target="_blank" rel="noopener noreferrer">{doc.url}</a></dd></div>}
          </dl>
        </header>

        <PaywallGate hasAccess={hasAccess} location="document" title="Subscribe to read this record" description="Campaign finance, lobbying, contract, property, and ethics records are available to HOKU Insider subscribers.">
          <section className="mb-10">
            <h2 className="text-xl font-bold mb-3">Relationships <span className="text-muted font-normal text-base tabular">({edges.length})</span></h2>
            <EdgeList edges={edges} />
          </section>

          {body && (
            <section className="mb-10">
              <h2 className="text-xl font-bold mb-3">Text</h2>
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed border-l-2 border-rule pl-4 max-h-[60vh] overflow-y-auto">{body.slice(0, BODY_LIMIT)}{body.length > BODY_LIMIT ? '\n…' : ''}</pre>
            </section>
          )}

          <section className="mb-10">
            <details>
              <summary className="cursor-pointer font-bold">Source record</summary>
              <p className="text-xs text-muted mt-2 tabular">sha256 {doc.checksum}</p>
              <pre className="mt-2 text-xs overflow-x-auto border border-rule p-3 max-h-[60vh]">{rawJson.length > BODY_LIMIT ? `${rawJson.slice(0, BODY_LIMIT)}\n…` : rawJson}</pre>
            </details>
          </section>
        </PaywallGate>
      </main>
      <Footer />
    </>
  )
}
