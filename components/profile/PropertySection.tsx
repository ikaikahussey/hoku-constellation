interface PropertySectionProps {
  properties: Record<string, unknown>[]
}

export function PropertySection({ properties }: PropertySectionProps) {
  if (properties.length === 0) {
    return <p className="text-white/30 text-sm py-4">No property ownership records linked yet.</p>
  }

  const totalAssessed = properties.reduce((sum, p) => sum + Number(p.assessed_value || 0), 0)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-navy-light rounded-lg border border-white/10 p-4">
          <p className="text-sm text-white/50">Properties</p>
          <p className="text-2xl font-bold text-white">{properties.length}</p>
        </div>
        {totalAssessed > 0 && (
          <div className="bg-navy-light rounded-lg border border-white/10 p-4">
            <p className="text-sm text-white/50">Total Assessed Value</p>
            <p className="text-2xl font-bold text-gold">${totalAssessed.toLocaleString()}</p>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {properties.map((p) => (
          <div key={p.id as string} className="bg-navy-light rounded-md border border-white/10 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-ocean">{String(p.tmk)}</span>
                  {p.county ? <span className="text-xs text-white/30">{String(p.county)}</span> : null}
                </div>
                {p.address ? (
                  <p className="text-sm text-white mt-1">{String(p.address)}</p>
                ) : null}
                <div className="flex items-center gap-3 mt-1.5">
                  {p.tax_class ? (
                    <span className="text-xs text-white/40">{String(p.tax_class).replace(/_/g, ' ')}</span>
                  ) : null}
                  {p.assessment_year ? (
                    <span className="text-xs text-white/30">Assessed {String(p.assessment_year)}</span>
                  ) : null}
                </div>
              </div>
              {p.assessed_value ? (
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-medium text-white">${Number(p.assessed_value).toLocaleString()}</p>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-white/20">
        Source: County real property assessment records. TMK = Tax Map Key.
      </p>
    </div>
  )
}
