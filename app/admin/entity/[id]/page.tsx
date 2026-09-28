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
import { adminEditHref, publicEntityHref } from '@/components/admin/links'
import { buttonClass } from '@/components/ui/Button'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, string> = { org: 'Organization', bill: 'Bill', docket: 'Docket', parcel: 'Parcel', office: 'Office', person: 'Person' }
const LIST_HREF: Record<string, string | undefined> = { org: '/admin/org', person: '/admin/person' }
const ORDER: Record<string, string[]> = {
  org: ['slug', 'org_type', 'sector', 'island', 'status', 'visibility', 'is_featured', 'website_url', 'city', 'state', 'registration_status'],
  bill: ['measure_number', 'session', 'chamber', 'title', 'current_status', 'introduced_date', 'measure_type', 'jurisdiction'],
  docket: ['docket_number', 'agency', 'title', 'docket_type', 'docket_status', 'filed_date', 'decision_date', 'utility_type'],
  parcel: ['tmk', 'county', 'address', 'tax_class', 'assessed_value', 'assessment_year', 'land_area_sqft'],
  office: ['office_type', 'jurisdiction', 'parent_agency', 'seat_count'],
}

/** Generic detail page for any entity kind (orgs, bills, dockets, parcels, offices). Persons redirect. */
export default async function AdminEntityDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = await getServiceDb()
  const entity = await getEntity(db, id)
  if (!entity) notFound()
  if (entity.kind === 'person') redirect(`/admin/person/${entity.id}`)
  if (entity.id !== id) redirect(`/admin/entity/${entity.id}`)

  const [edges, totals, documents] = await Promise.all([
    getEdges(db, entity.id, { limit: 500 }),
    getEdgeTotals(db, entity.id),
    getDocumentsForEntity(db, entity.id, { limit: 50 }),
  ])

  const edgeCount = totals.reduce((s, t) => s + t.n, 0)
  const moneyIn = totals.filter(t => t.direction === 'in' && ['contributed_to', 'awarded_contract', 'awarded_grant', 'loaned_to'].includes(t.type)).reduce((s, t) => s + t.sum, 0)
  const moneyOut = totals.filter(t => t.direction === 'out' && ['contributed_to', 'spent_with', 'loaned_to'].includes(t.type)).reduce((s, t) => s + t.sum, 0)
  const mentions = totals.filter(t => t.type === 'mentioned_in').reduce((s, t) => s + t.n, 0)

  const a = entity.attributes
  const { description, summary, ...restAttrs } = a
  const longText = typeof description === 'string' ? description : typeof summary === 'string' ? summary : null
  const editHref = adminEditHref(entity.kind, entity.id)
  const publicHref = publicEntityHref(entity.kind, typeof a.slug === 'string' ? a.slug : null)
  const listHref = LIST_HREF[entity.kind]

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm text-muted mb-2">
          {listHref ? <Link href={listHref}>{KIND_LABEL[entity.kind]}s</Link> : <span>{KIND_LABEL[entity.kind] ?? humanize(entity.kind)}</span>} / {entity.name}
        </p>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">{entity.name}</h1>
            <p className="text-xs text-muted mt-1"><span className="uppercase tracking-wide font-bold">{entity.kind}</span> · <span className="font-mono">{entity.id}</span></p>
          </div>
          <div className="flex gap-2">
            {publicHref && <Link href={publicHref} target="_blank" className={buttonClass('secondary', 'md')}>View public page ↗</Link>}
            {editHref && <Link href={editHref} className={buttonClass('primary', 'md')}>Edit</Link>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Edges" value={edgeCount} detail={`${edges.length.toLocaleString()} shown below`} />
        <StatCard label="Money in" value={formatAmount(moneyIn)} detail="contributions, contracts, grants, loans" />
        <StatCard label="Money out" value={formatAmount(moneyOut)} detail="contributions, spending, loans" />
        <StatCard label="Mentions" value={mentions} />
      </div>

      <AttributeTable title="Attributes" data={{ ...restAttrs, created_at: formatDate(entity.created_at), updated_at: formatDate(entity.updated_at) }} order={ORDER[entity.kind] ?? []} />

      {longText && (
        <section className="card bg-paper border border-rule p-6 mb-6">
          <h2 className="text-lg font-bold mb-2">{typeof description === 'string' ? 'Description' : 'Summary'}</h2>
          <p className="text-sm whitespace-pre-wrap">{longText}</p>
        </section>
      )}

      <section className="card bg-paper border border-rule p-6 mb-6">
        <h2 className="text-lg font-bold mb-2">Aliases</h2>
        {entity.aliases.length ? (
          <div className="flex flex-wrap gap-1">{entity.aliases.map((x, i) => <span key={i} className="border border-rule px-2 py-0.5 text-xs">{x}</span>)}</div>
        ) : <p className="text-sm text-muted">None</p>}
      </section>

      <AttributeTable title="Identifiers" data={entity.identifiers ?? {}} emptyMessage="No structured identifiers." />

      <EdgeGroups entityId={entity.id} edges={edges} />
      <DocumentList documents={documents} />
      <MergeForm fromId={entity.id} fromName={entity.name} />
    </div>
  )
}
