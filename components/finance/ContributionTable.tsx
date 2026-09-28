import Link from 'next/link'
import type { EdgeWithEnds } from '@/lib/db/queries/edges'
import { formatShortDate, formatCurrencyDetailed } from '@/lib/format'
import { otherEnd } from '@/components/profile/edges'

interface ContributionTableProps {
  /** `contributed_to` edges touching `entityId`. */
  edges: EdgeWithEnds[]
  entityId: string
  /** received = entity is the recipient (to_id); given = entity is the donor (from_id). */
  direction: 'received' | 'given'
  /** Render greyed placeholder rows (behind a PaywallGate) instead of data. */
  placeholder?: boolean
  caption?: string
}

function contributionType(edge: EdgeWithEnds): string {
  const t = edge.attributes?.contribution_type
  if (typeof t === 'string' && t) return t.replace(/_/g, ' ')
  if (edge.attributes?.non_monetary === true) return 'non-monetary'
  return edge.role?.replace(/_/g, ' ') ?? 'monetary'
}

export function ContributionTable({ edges, entityId, direction, placeholder = false, caption }: ContributionTableProps) {
  const otherLabel = direction === 'received' ? 'Donor' : 'Recipient'

  if (!placeholder && edges.length === 0) {
    return <p className="text-sm text-muted py-4">No contributions {direction} on record.</p>
  }

  const rows = placeholder ? Array.from({ length: 5 }, (_, i) => i) : edges

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-ink">
            <th scope="col" className="py-2 pr-3 text-left text-xs font-bold uppercase tracking-wide">Date</th>
            <th scope="col" className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wide">{otherLabel}</th>
            <th scope="col" className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wide">Type</th>
            <th scope="col" className="py-2 px-3 text-right text-xs font-bold uppercase tracking-wide">Amount</th>
            <th scope="col" className="py-2 pl-3 text-left text-xs font-bold uppercase tracking-wide">Source</th>
          </tr>
        </thead>
        <tbody>
          {placeholder
            ? (rows as number[]).map(i => (
                <tr key={i} className="border-b border-rule text-muted">
                  <td className="py-2 pr-3">Jan 1, 2024</td>
                  <td className="py-2 px-3">Subscriber-only donor record</td>
                  <td className="py-2 px-3">monetary</td>
                  <td className="py-2 px-3 text-right">$0.00</td>
                  <td className="py-2 pl-3">campaign spending commission</td>
                </tr>
              ))
            : (rows as EdgeWithEnds[]).map(edge => {
                const other = otherEnd(edge, entityId)
                const period = typeof edge.attributes?.election_period === 'string' ? edge.attributes.election_period : null
                return (
                  <tr key={edge.id} className="border-b border-rule">
                    <td className="py-2 pr-3 whitespace-nowrap">{edge.start_date ? formatShortDate(edge.start_date) : '—'}</td>
                    <td className="py-2 px-3">
                      {other.href ? <Link href={other.href}>{other.name}</Link> : other.name}
                      {edge.match_status !== 'matched' && other.href && <span className="ml-1 text-xs text-muted">(review)</span>}
                    </td>
                    <td className="py-2 px-3 text-muted">
                      {contributionType(edge)}{period ? ` · ${period}` : ''}
                    </td>
                    <td className="py-2 px-3 text-right font-bold whitespace-nowrap">
                      {edge.amount != null ? formatCurrencyDetailed(Number(edge.amount)) : '—'}
                    </td>
                    <td className="py-2 pl-3 text-muted">
                      {edge.doc_url ? (
                        <a href={edge.doc_url} target="_blank" rel="noopener noreferrer">{edge.doc_source.replace(/_/g, ' ')}</a>
                      ) : edge.doc_source.replace(/_/g, ' ')}
                    </td>
                  </tr>
                )
              })}
        </tbody>
      </table>
    </div>
  )
}
