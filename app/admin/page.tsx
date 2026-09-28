import Link from 'next/link'
import { getServiceDb } from '@/lib/db/service'
import { SOURCE_REGISTRY } from '@/lib/import/source-registry'
import type { ImportCursorRow } from '@/lib/db/types'
import { StatCard } from '@/components/admin/StatCard'
import { isOverdue } from '@/components/admin/cadence'
import { timeAgo } from '@/components/admin/format'
import { buttonClass } from '@/components/ui/Button'

export const dynamic = 'force-dynamic'

export default async function AdminDashboard() {
  const db = await getServiceDb()
  const liveSources = SOURCE_REGISTRY.filter(s => s.status === 'live')

  const [kinds, docs, edges, pendingEdges, cursors] = await Promise.all([
    db.many<{ kind: string; n: string }>(`select kind, count(*)::text n from entity where merged_into_id is null group by kind`),
    db.one<{ n: string; articles: string }>(`select count(*)::text n, count(*) filter (where doc_type = 'article')::text articles from document`),
    db.one<{ n: string }>(`select count(*)::text n from edge`),
    db.one<{ review: string; unmatched: string }>(
      `select count(*) filter (where match_status = 'review')::text review, count(*) filter (where match_status = 'unmatched')::text unmatched from edge where match_status <> 'matched'`),
    db.many<ImportCursorRow>(`select source, cursor_offset, last_run_at, status, metadata from import_cursor where source = any($1::text[])`, [liveSources.map(s => s.key)]),
  ])

  const byKind = new Map(kinds.map(k => [k.kind, Number(k.n)]))
  const cursorBySource = new Map(cursors.map(c => [c.source, c]))

  const pipeline = liveSources.map(s => {
    const c = cursorBySource.get(s.key)
    return {
      key: s.key, name: s.name, cadence: s.cadence,
      status: c?.status ?? 'idle',
      lastRunAt: c?.last_run_at ?? null,
      overdue: isOverdue(s.cadence, c?.last_run_at),
      error: c?.status === 'error',
    }
  })
  const overdueCount = pipeline.filter(p => p.overdue).length
  const errorCount = pipeline.filter(p => p.error).length
  const pipelineMessage = errorCount > 0
    ? `⚠ ${errorCount} pipeline${errorCount === 1 ? '' : 's'} failing`
    : overdueCount > 0
      ? `⚠ ${overdueCount} pipeline${overdueCount === 1 ? '' : 's'} overdue`
      : '● All live pipelines on schedule'

  const review = Number(pendingEdges?.review ?? 0)
  const unmatched = Number(pendingEdges?.unmatched ?? 0)

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Admin dashboard</h1>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <StatCard label="People" value={byKind.get('person') ?? 0} href="/admin/person" />
        <StatCard label="Organizations" value={byKind.get('org') ?? 0} href="/admin/org" />
        <StatCard label="Bills" value={byKind.get('bill') ?? 0} />
        <StatCard label="Dockets" value={byKind.get('docket') ?? 0} />
        <StatCard label="Parcels" value={byKind.get('parcel') ?? 0} />
        <StatCard label="Offices" value={byKind.get('office') ?? 0} />
        <StatCard label="Documents" value={Number(docs?.n ?? 0)} detail={`${Number(docs?.articles ?? 0).toLocaleString()} articles`} href="/admin/articles" />
        <StatCard label="Edges" value={Number(edges?.n ?? 0)} />
        <StatCard label="Edges needing review" value={review} href="/admin/match-review" />
        <StatCard label="Unmatched edges" value={unmatched} href="/admin/match-review" />
      </div>

      {(review + unmatched) > 0 && (
        <div className="border border-ink p-4 mb-8 flex items-center justify-between gap-4 flex-wrap">
          <p className="text-sm">
            <span className="font-bold">{(review + unmatched).toLocaleString()}</span> edges have an unresolved donor, recipient or party.
            {review > 0 && <> {review.toLocaleString()} have a fuzzy candidate awaiting confirmation.</>}
          </p>
          <Link href="/admin/match-review" className={buttonClass('secondary', 'sm')}>Review matches →</Link>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="card bg-paper border border-rule p-6">
          <h2 className="text-lg font-bold mb-4">Quick actions</h2>
          <ul className="space-y-2 text-sm">
            <li><Link href="/admin/person/new">+ Add a person</Link></li>
            <li><Link href="/admin/org/new">+ Add an organization</Link></li>
            <li><Link href="/admin/articles">+ Add an article</Link></li>
            <li><Link href="/admin/import">↑ Import data</Link></li>
            <li><Link href="/admin/bulk-create">↑ Bulk create entities</Link></li>
          </ul>
        </section>

        <section className="card bg-paper border border-rule p-6">
          <h2 className="text-lg font-bold mb-4">Pipeline health</h2>
          <p className="text-sm font-bold mb-1">{pipelineMessage}</p>
          <p className="text-xs text-muted mb-4">{liveSources.length} live source{liveSources.length === 1 ? '' : 's'} in the registry</p>
          <table className="w-full text-sm tabular">
            <thead>
              <tr className="border-b border-ink">
                <th scope="col" className="py-1.5 pr-3 text-left text-xs font-bold uppercase tracking-wide">Source</th>
                <th scope="col" className="py-1.5 pr-3 text-left text-xs font-bold uppercase tracking-wide">Cadence</th>
                <th scope="col" className="py-1.5 pr-3 text-left text-xs font-bold uppercase tracking-wide">Last run</th>
                <th scope="col" className="py-1.5 text-left text-xs font-bold uppercase tracking-wide">State</th>
              </tr>
            </thead>
            <tbody>
              {pipeline.map(p => (
                <tr key={p.key} className="border-b border-rule">
                  <td className="py-1.5 pr-3 font-mono text-xs">{p.key}</td>
                  <td className="py-1.5 pr-3 text-xs text-muted">{p.cadence.replace(/_/g, ' ')}</td>
                  <td className="py-1.5 pr-3 text-xs">{timeAgo(p.lastRunAt)}</td>
                  <td className={`py-1.5 text-xs ${p.error || p.overdue ? 'font-bold' : ''}`}>
                    {p.error ? '⚠ error' : p.overdue ? '⚠ overdue' : p.status === 'running' ? '● running' : `○ ${p.status}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Link href="/admin/workers" className="inline-block mt-4 text-sm">View pipeline status →</Link>
        </section>
      </div>
    </div>
  )
}
