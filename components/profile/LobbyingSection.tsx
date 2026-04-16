import Link from 'next/link'

interface LobbyingSectionProps {
  registrations: Record<string, unknown>[]
  expenditures: Record<string, unknown>[]
  orgExpenditures: Record<string, unknown>[]
}

export function LobbyingSection({ registrations, expenditures, orgExpenditures }: LobbyingSectionProps) {
  const hasData = registrations.length > 0 || expenditures.length > 0 || orgExpenditures.length > 0

  if (!hasData) {
    return <p className="text-white/30 text-sm py-4">No lobbying records linked yet.</p>
  }

  const totalExpenditure = orgExpenditures.reduce((sum, e) => sum + Number(e.amount || 0), 0)
  const totalLobbyistSpend = expenditures.reduce((sum, e) => sum + Number(e.amount || 0), 0)

  return (
    <div className="space-y-6">
      {(totalExpenditure > 0 || totalLobbyistSpend > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {totalExpenditure > 0 && (
            <div className="bg-navy-light rounded-lg border border-white/10 p-4">
              <p className="text-sm text-white/50">Organization Lobbying Spend</p>
              <p className="text-2xl font-bold text-gold">${totalExpenditure.toLocaleString()}</p>
            </div>
          )}
          {totalLobbyistSpend > 0 && (
            <div className="bg-navy-light rounded-lg border border-white/10 p-4">
              <p className="text-sm text-white/50">Lobbyist Expenditures</p>
              <p className="text-2xl font-bold text-gold">${totalLobbyistSpend.toLocaleString()}</p>
            </div>
          )}
        </div>
      )}

      {registrations.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-white/40 uppercase tracking-wider mb-3">
            Lobbyist Registrations
          </h3>
          <div className="space-y-2">
            {registrations.map((reg) => {
              const lobbyist = reg.lobbyist as Record<string, unknown> | null
              const firm = reg.firm as Record<string, unknown> | null
              return (
                <div key={reg.id as string} className="bg-navy-light rounded-md border border-white/10 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {lobbyist && (
                        <Link
                          href={`/person/${lobbyist.slug as string}`}
                          className="text-sm font-medium text-white hover:text-gold transition-colors"
                        >
                          {lobbyist.full_name as string}
                        </Link>
                      )}
                      {!lobbyist && reg.client_name_raw ? (
                        <span className="text-sm text-white">{String(reg.client_name_raw)}</span>
                      ) : null}
                      {firm && (
                        <p className="text-xs text-white/40">
                          via{' '}
                          <Link
                            href={`/org/${firm.slug as string}`}
                            className="text-white/50 hover:text-gold transition-colors"
                          >
                            {firm.name as string}
                          </Link>
                        </p>
                      )}
                      {reg.issues && (reg.issues as string[]).length > 0 ? (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {(reg.issues as string[]).map((issue, i) => (
                            <span key={i} className="text-xs rounded-full bg-white/5 px-2 py-0.5 text-white/40">
                              {issue}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="text-right flex-shrink-0">
                      {reg.registration_period ? (
                        <span className="text-xs text-white/30">{String(reg.registration_period)}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {orgExpenditures.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-white/40 uppercase tracking-wider mb-3">
            Lobbying Expenditures by Period
          </h3>
          <div className="bg-navy-light rounded-lg border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-3 px-4 text-white/50 font-medium">Period</th>
                  <th className="text-left py-3 px-4 text-white/50 font-medium">Type</th>
                  <th className="text-right py-3 px-4 text-white/50 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {orgExpenditures.map((e) => (
                  <tr key={e.id as string} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-3 px-4 text-white/60 text-xs">{String(e.period || '—')}</td>
                    <td className="py-3 px-4 text-white/40 text-xs">
                      {(e.expenditure_type as string || '').replace(/_/g, ' ')}
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-white">
                      ${Number(e.amount).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-white/20">
        Source: Hawai&#699;i State Ethics Commission lobbying disclosure filings.
      </p>
    </div>
  )
}
