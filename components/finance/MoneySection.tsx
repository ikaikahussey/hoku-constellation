import type { EdgeWithEnds, EdgeTotals } from '@/lib/db/queries/edges'
import { ContributionTable } from './ContributionTable'
import { PaywallGate } from '@/components/layout/PaywallGate'
import { formatCurrency } from '@/lib/format'
import { typeLabel } from '@/components/profile/edges'

interface MoneySectionProps {
  entityId: string
  hasAccess: boolean
  location: string
  received: EdgeWithEnds[]
  given: EdgeWithEnds[]
  totals: EdgeTotals[]
}

const MONEY_TYPES = ['contributed_to', 'spent_with', 'loaned_to', 'awarded_contract', 'awarded_grant', 'leases']

/** Money tab: totals from getEdgeTotals plus contributions received / given. Gated for non-subscribers. */
export function MoneySection({ entityId, hasAccess, location, received, given, totals }: MoneySectionProps) {
  const contribIn = totals.find(t => t.type === 'contributed_to' && t.direction === 'in')
  const contribOut = totals.find(t => t.type === 'contributed_to' && t.direction === 'out')
  const otherTotals = totals.filter(t => MONEY_TYPES.includes(t.type) && t.type !== 'contributed_to' && t.sum > 0)

  const body = (
    <div className="space-y-10">
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="border border-rule p-4">
          <dt className="text-xs text-muted uppercase tracking-wide">Received</dt>
          <dd className="text-2xl font-bold tabular">{hasAccess ? formatCurrency(contribIn?.sum ?? 0) : '$—'}</dd>
          <dd className="text-xs text-muted tabular">{hasAccess ? `${contribIn?.n ?? 0} contributions` : 'subscribers only'}</dd>
        </div>
        <div className="border border-rule p-4">
          <dt className="text-xs text-muted uppercase tracking-wide">Given</dt>
          <dd className="text-2xl font-bold tabular">{hasAccess ? formatCurrency(contribOut?.sum ?? 0) : '$—'}</dd>
          <dd className="text-xs text-muted tabular">{hasAccess ? `${contribOut?.n ?? 0} contributions` : 'subscribers only'}</dd>
        </div>
        {otherTotals.map(t => (
          <div key={`${t.type}-${t.direction}`} className="border border-rule p-4">
            <dt className="text-xs text-muted uppercase tracking-wide">{typeLabel(t.type)} ({t.direction === 'in' ? 'received' : 'paid'})</dt>
            <dd className="text-2xl font-bold tabular">{formatCurrency(t.sum)}</dd>
            <dd className="text-xs text-muted tabular">{t.n} records</dd>
          </div>
        ))}
      </dl>

      <section>
        <h3 className="text-xs font-bold uppercase tracking-wide mb-2">Contributions received</h3>
        <ContributionTable edges={received} entityId={entityId} direction="received" placeholder={!hasAccess} caption="Contributions received" />
      </section>

      <section>
        <h3 className="text-xs font-bold uppercase tracking-wide mb-2">Contributions given</h3>
        <ContributionTable edges={given} entityId={entityId} direction="given" placeholder={!hasAccess} caption="Contributions given" />
      </section>

      <p className="text-xs text-muted">
        Source: campaign finance filings from the Hawaiʻi Campaign Spending Commission and the FEC. Amounts are as reported in original filings.
      </p>
    </div>
  )

  return <PaywallGate hasAccess={hasAccess} location={location}>{body}</PaywallGate>
}
