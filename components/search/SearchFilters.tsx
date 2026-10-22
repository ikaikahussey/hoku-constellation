'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { normalizeToken, TAG_TAXONOMY } from '@/lib/entity-tags'

/** Top-level tag branches. Multi-tag filtering lives on /explore. */
const ENTITY_TYPES = TAG_TAXONOMY.map(b => ({ value: b.key, label: b.label }))

const ISLANDS = ['Oahu', 'Maui', 'Hawaii', 'Kauai', 'Molokai', 'Lanai', 'Statewide']

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`block w-full text-left px-3 py-1.5 text-sm border-l-2 ${active ? 'border-ink font-bold' : 'border-transparent text-muted hover:text-ink'}`}
    >
      {children}
    </button>
  )
}

export function SearchFilters() {
  const router = useRouter()
  const searchParams = useSearchParams()

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    params.delete('page')
    router.push(`/search?${params.toString()}`)
  }

  const currentType = searchParams.get('type') || ''
  const currentIsland = searchParams.get('island') || ''
  const currentStatus = searchParams.get('status') || ''
  const currentEntityType = normalizeToken(searchParams.get('entityType') || '')

  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="text-xs font-bold uppercase tracking-wide mb-2">Type</legend>
        <FilterButton active={!currentType} onClick={() => updateFilter('type', '')}>All</FilterButton>
        <FilterButton active={currentType === 'person'} onClick={() => updateFilter('type', 'person')}>People</FilterButton>
        <FilterButton active={currentType === 'organization'} onClick={() => updateFilter('type', 'organization')}>Organizations</FilterButton>
        <FilterButton active={currentType === 'bill'} onClick={() => updateFilter('type', 'bill')}>Bills</FilterButton>
      </fieldset>

      {currentType !== 'bill' && (
        <fieldset>
          <legend className="text-xs font-bold uppercase tracking-wide mb-2">Tags</legend>
          {ENTITY_TYPES.map(et => (
            <FilterButton
              key={et.value}
              active={currentEntityType === et.value}
              onClick={() => updateFilter('entityType', currentEntityType === et.value ? '' : et.value)}
            >
              {et.label}
            </FilterButton>
          ))}
        </fieldset>
      )}

      <fieldset>
        <legend className="text-xs font-bold uppercase tracking-wide mb-2">Island</legend>
        <FilterButton active={!currentIsland} onClick={() => updateFilter('island', '')}>All islands</FilterButton>
        {ISLANDS.map(island => (
          <FilterButton key={island} active={currentIsland === island} onClick={() => updateFilter('island', currentIsland === island ? '' : island)}>
            {island}
          </FilterButton>
        ))}
      </fieldset>

      <fieldset>
        <legend className="text-xs font-bold uppercase tracking-wide mb-2">Status</legend>
        {['', 'active', 'former', 'inactive'].map(s => (
          <FilterButton key={s} active={currentStatus === s} onClick={() => updateFilter('status', s)}>
            {s || 'All'}
          </FilterButton>
        ))}
      </fieldset>
    </div>
  )
}
