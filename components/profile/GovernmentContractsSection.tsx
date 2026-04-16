interface GovernmentContractsSectionProps {
  contracts: Record<string, unknown>[]
}

export function GovernmentContractsSection({ contracts }: GovernmentContractsSectionProps) {
  if (contracts.length === 0) {
    return <p className="text-white/30 text-sm py-4">No government contract records linked yet.</p>
  }

  const totalValue = contracts.reduce((sum, c) => sum + Number(c.contract_amount || 0), 0)

  return (
    <div className="space-y-6">
      {totalValue > 0 && (
        <div className="bg-navy-light rounded-lg border border-white/10 p-4 inline-block">
          <p className="text-sm text-white/50">Total Contract Value</p>
          <p className="text-2xl font-bold text-gold">${totalValue.toLocaleString()}</p>
          <p className="text-xs text-white/30 mt-1">{contracts.length} contract{contracts.length !== 1 ? 's' : ''}</p>
        </div>
      )}

      <div className="bg-navy-light rounded-lg border border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left py-3 px-4 text-white/50 font-medium">Award Date</th>
              <th className="text-left py-3 px-4 text-white/50 font-medium">Agency</th>
              <th className="text-left py-3 px-4 text-white/50 font-medium hidden md:table-cell">Description</th>
              <th className="text-right py-3 px-4 text-white/50 font-medium">Amount</th>
              <th className="text-left py-3 px-4 text-white/50 font-medium hidden sm:table-cell">Source</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.id as string} className="border-b border-white/5 hover:bg-white/5">
                <td className="py-3 px-4 text-white/60 text-xs">
                  {c.award_date ? new Date(c.award_date as string).toLocaleDateString() : '—'}
                </td>
                <td className="py-3 px-4 text-white text-xs">{String(c.awarding_agency || '—')}</td>
                <td className="py-3 px-4 text-white/40 text-xs hidden md:table-cell max-w-xs truncate">
                  {String(c.description || '—')}
                </td>
                <td className="py-3 px-4 text-right font-medium text-white">
                  {c.contract_amount ? `$${Number(c.contract_amount).toLocaleString()}` : '—'}
                </td>
                <td className="py-3 px-4 text-white/30 text-xs hidden sm:table-cell">
                  {(c.source as string || '').replace(/_/g, ' ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-white/20">
        Source: Federal procurement data (USAspending.gov) and state/county procurement records.
      </p>
    </div>
  )
}
