interface ContributionTableProps {
  contributions: Record<string, unknown>[]
  entityId: string
  entityType: 'person' | 'organization'
}

export function ContributionTable({ contributions, entityId, entityType }: ContributionTableProps) {
  if (contributions.length === 0) {
    return <p className="text-white/30 text-sm py-4">No campaign finance records linked yet.</p>
  }

  // Calculate totals
  const totalReceived = contributions
    .filter((c) => c.recipient_person_id === entityId || c.recipient_org_id === entityId)
    .reduce((sum, c) => sum + Number(c.amount), 0)

  const totalGiven = contributions
    .filter((c) => c.donor_person_id === entityId || c.donor_org_id === entityId)
    .reduce((sum, c) => sum + Number(c.amount), 0)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {totalReceived > 0 && (
          <div className="bg-navy-light rounded-lg border border-white/10 p-4">
            <p className="text-sm text-white/50">Total Received</p>
            <p className="text-2xl font-bold text-gold">${totalReceived.toLocaleString()}</p>
          </div>
        )}
        {totalGiven > 0 && (
          <div className="bg-navy-light rounded-lg border border-white/10 p-4">
            <p className="text-sm text-white/50">Total Given</p>
            <p className="text-2xl font-bold text-gold">${totalGiven.toLocaleString()}</p>
          </div>
        )}
      </div>

      <div className="bg-navy-light rounded-lg border border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left py-3 px-4 text-white/50 font-medium">Date</th>
              <th className="text-left py-3 px-4 text-white/50 font-medium">
                {entityType === 'person' ? 'Donor / Recipient' : 'Entity'}
              </th>
              <th className="text-left py-3 px-4 text-white/50 font-medium">Type</th>
              <th className="text-right py-3 px-4 text-white/50 font-medium">Amount</th>
              <th className="text-left py-3 px-4 text-white/50 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {contributions.map((c) => {
              const isRecipient = c.recipient_person_id === entityId || c.recipient_org_id === entityId
              return (
                <tr key={c.id as string} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-3 px-4 text-white/60 text-xs">
                    {c.contribution_date ? new Date(c.contribution_date as string).toLocaleDateString() : '—'}
                  </td>
                  <td className="py-3 px-4 text-white">
                    {isRecipient ? (c.donor_name_raw as string) : (c.recipient_name_raw as string)}
                    {isRecipient && <span className="text-xs text-white/30 ml-1">(donor)</span>}
                    {!isRecipient && <span className="text-xs text-white/30 ml-1">(recipient)</span>}
                  </td>
                  <td className="py-3 px-4 text-white/40 text-xs">{(c.contribution_type as string || '').replace(/_/g, ' ')}</td>
                  <td className="py-3 px-4 text-right font-medium text-white">
                    ${Number(c.amount).toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-white/30 text-xs">{(c.source as string || '').replace(/_/g, ' ')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-white/20">
        Source: Campaign finance records from state and county agencies. All amounts are as reported in original filings.
      </p>
    </div>
  )
}
