'use client'

import { useRouter, useSearchParams } from 'next/navigation'

const ENTITY_TYPES = [
  { value: 'elected_official', label: 'Elected Official' },
  { value: 'appointed_official', label: 'Appointed Official' },
  { value: 'lobbyist', label: 'Lobbyist' },
  { value: 'donor', label: 'Donor' },
  { value: 'contractor', label: 'Contractor' },
  { value: 'nonprofit_leader', label: 'Nonprofit Leader' },
  { value: 'business_leader', label: 'Business Leader' },
  { value: 'labor_leader', label: 'Labor Leader' },
]

const ORG_TYPES = [
  { value: 'government_agency', label: 'Government Agency' },
  { value: 'nonprofit', label: 'Nonprofit' },
  { value: 'corporation', label: 'Corporation' },
  { value: 'pac', label: 'PAC' },
  { value: 'lobbying_firm', label: 'Lobbying Firm' },
  { value: 'labor_union', label: 'Labor Union' },
]

const ISLANDS = ['Oahu', 'Maui', 'Hawaii', 'Kauai', 'Molokai', 'Lanai', 'Statewide']

export function SearchFilters() {
  const router = useRouter()
  const searchParams = useSearchParams()

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    params.set('page', '1')
    router.push(`/search?${params.toString()}`)
  }

  const currentType = searchParams.get('type') || ''
  const currentIsland = searchParams.get('island') || ''
  const currentStatus = searchParams.get('status') || ''

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Entity Type</h3>
        <div className="space-y-1">
          <button
            onClick={() => updateFilter('type', '')}
            className={`block w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
              !currentType ? 'text-gold bg-gold/10' : 'text-white/50 hover:text-white hover:bg-white/5'
            }`}
          >
            All
          </button>
          <button
            onClick={() => updateFilter('type', 'person')}
            className={`block w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
              currentType === 'person' ? 'text-gold bg-gold/10' : 'text-white/50 hover:text-white hover:bg-white/5'
            }`}
          >
            People
          </button>
          <button
            onClick={() => updateFilter('type', 'organization')}
            className={`block w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
              currentType === 'organization' ? 'text-gold bg-gold/10' : 'text-white/50 hover:text-white hover:bg-white/5'
            }`}
          >
            Organizations
          </button>
        </div>
      </div>

      {currentType !== 'organization' && (
        <div>
          <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Person Type</h3>
          <div className="space-y-1">
            {ENTITY_TYPES.map((et) => (
              <button
                key={et.value}
                onClick={() => updateFilter('entityType', searchParams.get('entityType') === et.value ? '' : et.value)}
                className={`block w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
                  searchParams.get('entityType') === et.value ? 'text-gold bg-gold/10' : 'text-white/50 hover:text-white hover:bg-white/5'
                }`}
              >
                {et.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Island</h3>
        <div className="space-y-1">
          <button
            onClick={() => updateFilter('island', '')}
            className={`block w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
              !currentIsland ? 'text-gold bg-gold/10' : 'text-white/50 hover:text-white hover:bg-white/5'
            }`}
          >
            All Islands
          </button>
          {ISLANDS.map((island) => (
            <button
              key={island}
              onClick={() => updateFilter('island', currentIsland === island ? '' : island)}
              className={`block w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
                currentIsland === island ? 'text-gold bg-gold/10' : 'text-white/50 hover:text-white hover:bg-white/5'
              }`}
            >
              {island}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Status</h3>
        <div className="space-y-1">
          {['', 'active', 'former', 'inactive'].map((s) => (
            <button
              key={s}
              onClick={() => updateFilter('status', s)}
              className={`block w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
                currentStatus === s ? 'text-gold bg-gold/10' : 'text-white/50 hover:text-white hover:bg-white/5'
              }`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
