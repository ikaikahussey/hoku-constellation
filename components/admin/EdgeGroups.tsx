import Link from 'next/link'
import type { EdgeWithEnds } from '@/lib/db/queries'
import { formatAmount, formatDate, humanize } from './format'
import { adminEntityHref } from './links'

interface Props {
  entityId: string
  edges: EdgeWithEnds[]
}

interface Group { type: string; direction: 'in' | 'out'; rows: EdgeWithEnds[] }

function groupEdges(entityId: string, edges: EdgeWithEnds[]): Group[] {
  const map = new Map<string, Group>()
  for (const e of edges) {
    const direction: 'in' | 'out' = e.from_id === entityId ? 'out' : 'in'
    const key = `${e.type}:${direction}`
    if (!map.has(key)) map.set(key, { type: e.type, direction, rows: [] })
    map.get(key)!.rows.push(e)
  }
  return [...map.values()].sort((a, b) => b.rows.length - a.rows.length || a.type.localeCompare(b.type))
}

function OtherEnd({ e, direction }: { e: EdgeWithEnds; direction: 'in' | 'out' }) {
  const id = direction === 'out' ? e.to_id : e.from_id
  const name = direction === 'out' ? e.to_name : e.from_name
  const raw = direction === 'out' ? e.to_name_raw : e.from_name_raw
  const kind = direction === 'out' ? e.to_kind : e.from_kind
  if (id && name) return <Link href={adminEntityHref(kind, id)}>{name}</Link>
  if (raw) return <span>{raw} <span className="text-xs text-muted">(unresolved)</span></span>
  return <span className="text-gray-400">—</span>
}

/** Edges touching an entity, grouped by type and direction. Money columns shown when any row has an amount. */
export function EdgeGroups({ entityId, edges }: Props) {
  const groups = groupEdges(entityId, edges)
  if (!groups.length) {
    return <section className="card bg-paper border border-rule p-6 mb-6"><h2 className="text-lg font-bold mb-2">Edges</h2><p className="text-sm text-muted">No edges yet.</p></section>
  }
  return (
    <>
      {groups.map(g => {
        const hasAmount = g.rows.some(r => r.amount !== null && r.amount !== undefined)
        const total = hasAmount ? g.rows.reduce((s, r) => s + Number(r.amount ?? 0), 0) : 0
        return (
          <section key={`${g.type}:${g.direction}`} className="card bg-paper border border-rule p-6 mb-6">
            <div className="flex items-baseline justify-between gap-4 mb-4 flex-wrap">
              <h2 className="text-lg font-bold">
                {humanize(g.type)} <span className="text-muted font-normal text-sm">{g.direction === 'out' ? '→ outgoing' : '← incoming'} · {g.rows.length.toLocaleString()}</span>
              </h2>
              {hasAmount && <p className="text-sm tabular">Total shown: <span className="font-bold">{formatAmount(total)}</span></p>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular">
                <thead>
                  <tr className="border-b border-ink">
                    <th scope="col" className="py-2 pr-3 text-left text-xs font-bold uppercase tracking-wide">Date</th>
                    <th scope="col" className="py-2 pr-3 text-left text-xs font-bold uppercase tracking-wide">{g.direction === 'out' ? 'To' : 'From'}</th>
                    <th scope="col" className="py-2 pr-3 text-left text-xs font-bold uppercase tracking-wide">Role</th>
                    {hasAmount && <th scope="col" className="py-2 pr-3 text-right text-xs font-bold uppercase tracking-wide">Amount</th>}
                    <th scope="col" className="py-2 pr-3 text-left text-xs font-bold uppercase tracking-wide">Match</th>
                    <th scope="col" className="py-2 text-left text-xs font-bold uppercase tracking-wide">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map(e => (
                    <tr key={e.id} className="border-b border-rule">
                      <td className="py-2 pr-3 whitespace-nowrap text-xs">{formatDate(e.start_date)}{e.end_date ? ` → ${formatDate(e.end_date)}` : ''}</td>
                      <td className="py-2 pr-3"><OtherEnd e={e} direction={g.direction} /></td>
                      <td className="py-2 pr-3 text-muted text-xs">{e.role || '—'}</td>
                      {hasAmount && <td className="py-2 pr-3 text-right font-bold">{formatAmount(e.amount)}</td>}
                      <td className="py-2 pr-3 text-xs">{e.match_status}{e.match_confidence !== null ? ` (${Math.round(e.match_confidence * 100)}%)` : ''}</td>
                      <td className="py-2 text-xs text-muted">
                        {e.doc_url ? <a href={e.doc_url} target="_blank" rel="noopener noreferrer">{e.doc_source}</a> : e.doc_source}
                        {' · '}{humanize(e.doc_type)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}
    </>
  )
}
