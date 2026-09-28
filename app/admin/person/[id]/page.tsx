import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getServiceDb } from '@/lib/db/service'
import { getEntity, getEdges, getEdgeTotals, getDocumentsForEntity } from '@/lib/db/queries'
import { AttributeTable } from '@/components/admin/AttributeTable'
import { EdgeGroups } from '@/components/admin/EdgeGroups'
import { DocumentList } from '@/components/admin/DocumentList'
import { MergeForm } from '@/components/admin/MergeForm'
import { StatCard } from '@/components/admin/StatCard'
import { formatAmount, formatDate, humanize } from '@/components/admin/format'
import { publicEntityHref } from '@/components/admin/links'
import { buttonClass } from '@/components/ui/Button'

export const dynamic = 'force-dynamic'

const PERSON_ORDER = ['slug', 'first_name', 'last_name', 'office_held', 'party', 'district', 'island', 'term_start', 'term_end', 'status', 'visibility', 'is_featured', 'website_url', 'photo_url']

export default async function AdminPersonDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = await getServiceDb()
  const person = await getEntity(db, id)
  if (!person) notFound()
  if (person.id !== id) redirect(`/admin/person/${person.id}`) // followed a merge
  if (person.kind !== 'person') redirect(`/admin/entity/${person.id}`)

  const [edges, totals, documents] = await Promise.all([
    getEdges(db, person.id, { limit: 500 }),
    getEdgeTotals(db, person.id),
    getDocumentsForEntity(db, person.id, { limit: 50 }),
  ])

  const received = totals.find(t => t.type === 'contributed_to' && t.direction === 'in')
  const given = totals.find(t => t.type === 'contributed_to' && t.direction === 'out')
  const edgeCount = totals.reduce((s, t) => s + t.n, 0)
  const mentions = totals.filter(t => t.type === 'mentioned_in').reduce((s, t) => s + t.n, 0)

  const a = person.attributes
  const types = Array.isArray(a.entity_types) ? (a.entity_types as string[]) : []
  const publicHref = publicEntityHref('person', typeof a.slug === 'string' ? a.slug : null)
  const { entity_types: _types, bio_summary, ...restAttrs } = a
  void _types

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm text-muted mb-2"><Link href="/admin/person">People</Link> / {person.name}</p>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">{person.name}</h1>
            <p className="text-xs font-mono text-muted mt-1">{person.id}</p>
            {types.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {types.map(t => <span key={t} className="border border-rule px-2 py-0.5 text-xs">{humanize(t)}</span>)}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {publicHref && <Link href={publicHref} target="_blank" className={buttonClass('secondary', 'md')}>View public profile ↗</Link>}
            <Link href={`/admin/person/${person.id}/edit`} className={buttonClass('primary', 'md')}>Edit</Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Contributions received" value={received?.n ?? 0} detail={formatAmount(received?.sum ?? 0)} />
        <StatCard label="Contributions given" value={given?.n ?? 0} detail={formatAmount(given?.sum ?? 0)} />
        <StatCard label="Edges" value={edgeCount} detail={`${edges.length.toLocaleString()} shown below`} />
        <StatCard label="Article mentions" value={mentions} />
      </div>

      <AttributeTable title="Attributes" data={{ ...restAttrs, created_at: formatDate(person.created_at), updated_at: formatDate(person.updated_at) }} order={PERSON_ORDER} />

      {typeof bio_summary === 'string' && bio_summary && (
        <section className="card bg-paper border border-rule p-6 mb-6">
          <h2 className="text-lg font-bold mb-2">Bio</h2>
          <p className="text-sm whitespace-pre-wrap">{bio_summary}</p>
        </section>
      )}

      <section className="card bg-paper border border-rule p-6 mb-6">
        <h2 className="text-lg font-bold mb-2">Aliases</h2>
        {person.aliases.length ? (
          <div className="flex flex-wrap gap-1">{person.aliases.map((x, i) => <span key={i} className="border border-rule px-2 py-0.5 text-xs">{x}</span>)}</div>
        ) : <p className="text-sm text-muted">None</p>}
      </section>

      <AttributeTable title="Identifiers" data={person.identifiers ?? {}} emptyMessage="No structured identifiers." />

      <EdgeGroups entityId={person.id} edges={edges} />
      <DocumentList documents={documents} />
      <MergeForm fromId={person.id} fromName={person.name} />
    </div>
  )
}
