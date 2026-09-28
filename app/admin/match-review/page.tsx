import Link from 'next/link'
import { getServiceDb } from '@/lib/db/service'
import { listReviewEdges, type EdgeWithEnds } from '@/lib/db/queries'
import { fuzzyMatch } from '@/lib/entity-match'
import { EDGE_TYPES } from '@/lib/schema/attributes'
import { MatchReviewActions, type Candidate } from '@/components/admin/MatchReviewActions'
import { formatAmount, formatDate, humanize } from '@/components/admin/format'
import { adminEntityHref } from '@/components/admin/links'
import { buttonClass } from '@/components/ui/Button'
import { inputClass } from '@/components/ui/Input'
import type { Db } from '@/lib/db/types'

export const dynamic = 'force-dynamic'

const PER_PAGE = 25

async function candidatesFor(db: Db, rawName: string): Promise<Candidate[]> {
  const [persons, orgs] = await Promise.all([
    fuzzyMatch(db, rawName, { kind: 'person', limit: 10 }),
    fuzzyMatch(db, rawName, { kind: 'org', limit: 10 }),
  ])
  return [
    ...persons.map(c => ({ ...c, kind: 'person' })),
    ...orgs.map(c => ({ ...c, kind: 'org' })),
  ].sort((a, b) => b.confidence - a.confidence).slice(0, 3)
}

function ResolvedEnd({ id, name, kind }: { id: string | null; name: string | null; kind: string | null }) {
  if (!id) return <span className="text-gray-400">—</span>
  return <Link href={adminEntityHref(kind, id)}>{name ?? id}</Link>
}

export default async function MatchReview({ searchParams }: { searchParams: Promise<{ type?: string; page?: string }> }) {
  const params = await searchParams
  const type = params.type && (EDGE_TYPES as readonly string[]).includes(params.type) ? params.type : undefined
  const page = Math.max(1, parseInt(params.page || '1', 10) || 1)
  const offset = (page - 1) * PER_PAGE

  const db = await getServiceDb()
  const [edges, pending] = await Promise.all([
    listReviewEdges(db, { limit: PER_PAGE, offset, type }),
    db.one<{ n: string }>(`select count(*)::text n from edge where match_status <> 'matched'${type ? ' and type = $1' : ''}`, type ? [type] : []),
  ])
  const total = Number(pending?.n ?? 0)

  // Fuzzy candidates for every unresolved side, in parallel.
  const sides = edges.flatMap(e => {
    const out: Array<{ edge: EdgeWithEnds; side: 'from' | 'to'; raw: string }> = []
    if (!e.from_id && e.from_name_raw) out.push({ edge: e, side: 'from', raw: e.from_name_raw })
    if (!e.to_id && e.to_name_raw) out.push({ edge: e, side: 'to', raw: e.to_name_raw })
    return out
  })
  const candidateLists = await Promise.all(sides.map(s => candidatesFor(db, s.raw)))
  const candidates = new Map(sides.map((s, i) => [`${s.edge.id}:${s.side}`, candidateLists[i]]))

  const qs = (p: number) => {
    const u = new URLSearchParams()
    if (type) u.set('type', type)
    if (p > 1) u.set('page', String(p))
    const s = u.toString()
    return s ? `/admin/match-review?${s}` : '/admin/match-review'
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-bold">Match review</h1>
          <p className="text-sm text-muted mt-1">
            {total.toLocaleString()} edge{total === 1 ? '' : 's'} with an unresolved side. Highest amounts first. Link a side to an entity, or mark it unmatched to clear the review flag.
          </p>
        </div>
        <form className="flex gap-2 items-end">
          <label className="text-sm">
            <span className="block text-xs font-bold mb-1">Edge type</span>
            <select name="type" defaultValue={type ?? ''} className={`${inputClass} py-1.5 text-sm`}>
              <option value="">All types</option>
              {EDGE_TYPES.map(t => <option key={t} value={t}>{humanize(t)}</option>)}
            </select>
          </label>
          <button type="submit" className={buttonClass('secondary', 'sm')}>Filter</button>
        </form>
      </div>

      {edges.length === 0 ? (
        <div className="border border-rule p-12 text-center text-muted">Nothing to review. All caught up.</div>
      ) : (
        <ol className="space-y-4">
          {edges.map(e => (
            <li key={e.id} className="card bg-paper border border-rule p-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="text-sm space-y-1">
                  <p><span className="text-xs font-bold uppercase tracking-wide border border-ink px-1.5 py-0.5 mr-2">{humanize(e.type)}</span>
                    <span className="text-xs text-muted">{e.match_status}{e.match_confidence !== null ? ` · best ${Math.round(e.match_confidence * 100)}%` : ''}</span></p>
                  <p><span className="text-muted">From:</span> <span className="font-bold">{e.from_name_raw ?? '—'}</span>{e.from_id && <> → <ResolvedEnd id={e.from_id} name={e.from_name} kind={e.from_kind} /></>}</p>
                  <p><span className="text-muted">To:</span> <span className="font-bold">{e.to_name_raw ?? '—'}</span>{e.to_id && <> → <ResolvedEnd id={e.to_id} name={e.to_name} kind={e.to_kind} /></>}</p>
                  <p className="text-muted tabular">
                    {e.amount !== null && <>{formatAmount(e.amount)} · </>}{formatDate(e.start_date)}{e.role ? ` · ${e.role}` : ''}
                    {' · '}{e.doc_url ? <a href={e.doc_url} target="_blank" rel="noopener noreferrer">{e.doc_source}</a> : e.doc_source} / {humanize(e.doc_type)}
                  </p>
                </div>
                <p className="text-xs font-mono text-muted">{e.id}</p>
              </div>
              {!e.from_id && e.from_name_raw && (
                <MatchReviewActions edgeId={e.id} side="from" rawName={e.from_name_raw} candidates={candidates.get(`${e.id}:from`) ?? []} />
              )}
              {!e.to_id && e.to_name_raw && (
                <MatchReviewActions edgeId={e.id} side="to" rawName={e.to_name_raw} candidates={candidates.get(`${e.id}:to`) ?? []} />
              )}
            </li>
          ))}
        </ol>
      )}

      <div className="flex items-center justify-between mt-6 text-sm tabular">
        <span className="text-muted">Page {page} · {Math.max(1, Math.ceil(total / PER_PAGE))} total</span>
        <span className="flex gap-3">
          {page > 1 && <Link href={qs(page - 1)}>‹ Previous</Link>}
          {offset + edges.length < total && <Link href={qs(page + 1)}>Next ›</Link>}
        </span>
      </div>
    </div>
  )
}
