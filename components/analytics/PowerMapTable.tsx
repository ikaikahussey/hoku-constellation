import Link from 'next/link'
import { entityHref } from '@/components/search/EntityCard'

interface Row {
  entity_id: string
  composite_score: number | string
  rank: number | null
  entity?: {
    id?: string
    name?: string
    kind?: string
    slug?: string | null
    office_held?: string | null
    island?: string | null
  } | null
}

export function PowerMapTable({ rows }: { rows: Row[] }) {
  if (!rows.length) return <p className="text-sm text-muted">No scores computed yet.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular">
        <caption className="sr-only">Power map: entities ranked by composite influence score</caption>
        <thead>
          <tr className="border-b border-ink text-left">
            <th scope="col" className="py-2 pr-4 text-xs font-bold uppercase tracking-wide">#</th>
            <th scope="col" className="py-2 pr-4 text-xs font-bold uppercase tracking-wide">Name</th>
            <th scope="col" className="py-2 pr-4 text-xs font-bold uppercase tracking-wide">Role</th>
            <th scope="col" className="py-2 pr-4 text-xs font-bold uppercase tracking-wide">Island</th>
            <th scope="col" className="py-2 text-right text-xs font-bold uppercase tracking-wide">Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const score = Number(r.composite_score)
            const href = r.entity ? entityHref(r.entity.kind ?? 'person', r.entity.slug ?? null, r.entity_id) : null
            const name = r.entity?.name ?? r.entity_id
            return (
              <tr key={r.entity_id} className="border-b border-rule">
                <td className="py-2 pr-4">{r.rank ?? i + 1}</td>
                <td className="py-2 pr-4 font-bold">{href ? <Link href={href}>{name}</Link> : name}</td>
                <td className="py-2 pr-4 text-muted">{r.entity?.office_held ?? '—'}</td>
                <td className="py-2 pr-4 text-muted">{r.entity?.island ?? '—'}</td>
                <td className="py-2 text-right whitespace-nowrap">
                  <span className="inline-block w-12 text-right">{score.toFixed(1)}</span>
                  <span
                    className="ml-2 inline-block h-2 bg-ink align-middle"
                    style={{ width: `${Math.min(100, Math.max(0, score))}px` }}
                    aria-hidden="true"
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default PowerMapTable
