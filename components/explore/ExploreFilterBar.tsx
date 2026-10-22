'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { inputClass } from '@/components/ui/Input'
import { buttonClass } from '@/components/ui/Button'
import { exploreUrl, hasActiveFilters, type ExploreFacets, type ExploreFilters, type FacetOption } from '@/lib/explore/filters'

interface Props { filters: ExploreFilters; facets: ExploreFacets }

const n = (x: number) => x.toLocaleString('en-US')

function FacetSelect({ id, label, value, options, onChange, disabled }: {
  id: string; label: string; value: string; options: FacetOption[]; onChange: (v: string) => void; disabled?: boolean
}) {
  // Keep the current value selectable even when it has no matches under the other filters.
  const opts = value && !options.some(o => o.value === value) ? [{ value, label: value, count: 0 }, ...options] : options
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-xs font-bold uppercase tracking-wide mb-1">{label}</label>
      <select id={id} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} className={`${inputClass} text-sm disabled:opacity-50`}>
        <option value="">All</option>
        {opts.map(o => <option key={o.value} value={o.value}>{o.label} ({n(o.count)})</option>)}
      </select>
    </div>
  )
}

export function ExploreFilterBar({ filters, facets }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [q, setQ] = useState(filters.q)
  // The last name filter this component requested. A URL change that does not match it came from
  // elsewhere (back/forward, a link), so the input follows it; a matching one is our own echo and
  // must not overwrite what the user has typed since.
  const [pushed, setPushed] = useState(filters.q)
  const [seen, setSeen] = useState(filters.q)
  if (seen !== filters.q) {
    setSeen(filters.q)
    if (filters.q !== pushed) { setQ(filters.q); setPushed(filters.q) }
  }

  const go = (patch: Partial<ExploreFilters>) => {
    startTransition(() => router.replace(exploreUrl(filters, patch), { scroll: false }))
  }

  // Debounced name filter.
  const filtersKey = exploreUrl(filters, { page: filters.page })
  useEffect(() => {
    const value = q.trim()
    if (value === pushed) return
    const t = setTimeout(() => { setPushed(value); go({ q: value }) }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, pushed, filtersKey])

  const kindButton = (value: ExploreFilters['kind'], label: string, count: number) => {
    const active = filters.kind === value
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={() => go({ kind: value, ...(value === 'org' ? { role: '' } : {}), ...(value === 'person' ? { orgType: '', sector: '' } : {}) })}
        className={`px-3 py-2 text-sm border border-ink -ml-px first:ml-0 ${active ? 'bg-ink text-paper font-bold' : 'bg-paper text-ink'}`}
      >
        {label} <span className="tabular">{n(count)}</span>
      </button>
    )
  }

  return (
    <form role="search" aria-label="Filter people and organizations" onSubmit={e => { e.preventDefault(); setPushed(q.trim()); go({ q: q.trim() }) }} className="space-y-4" aria-busy={pending}>
      <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
        <div className="flex-1 min-w-0">
          <label htmlFor="explore-q" className="block text-xs font-bold uppercase tracking-wide mb-1">Name</label>
          <input id="explore-q" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by name or alias" autoComplete="off" className={inputClass} />
        </div>
        <div role="group" aria-label="Type" className="flex">
          {kindButton(null, 'All', facets.kind.person + facets.kind.org)}
          {kindButton('person', 'People', facets.kind.person)}
          {kindButton('org', 'Organizations', facets.kind.org)}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <FacetSelect id="explore-role" label="Role" value={filters.role} options={facets.role} onChange={v => go({ role: v })} disabled={filters.kind === 'org'} />
        <FacetSelect id="explore-org-type" label="Org type" value={filters.orgType} options={facets.orgType} onChange={v => go({ orgType: v })} disabled={filters.kind === 'person'} />
        <FacetSelect id="explore-sector" label="Sector" value={filters.sector} options={facets.sector} onChange={v => go({ sector: v })} disabled={filters.kind === 'person'} />
        <FacetSelect id="explore-island" label="Island" value={filters.island} options={facets.island} onChange={v => go({ island: v })} />
        <FacetSelect id="explore-status" label="Status" value={filters.status} options={facets.status} onChange={v => go({ status: v })} />
        <div className="min-w-0">
          <label htmlFor="explore-sort" className="block text-xs font-bold uppercase tracking-wide mb-1">Sort</label>
          <select id="explore-sort" value={filters.sort} onChange={e => go({ sort: e.target.value as ExploreFilters['sort'] })} className={`${inputClass} text-sm`}>
            <option value="name">Name A–Z</option>
            <option value="updated">Recently updated</option>
            <option value="added">Recently added</option>
          </select>
        </div>
      </div>

      {hasActiveFilters(filters) && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => { setQ(''); setPushed(''); startTransition(() => router.replace('/explore', { scroll: false })) }} className={buttonClass('secondary', 'sm')}>
            Clear filters
          </button>
        </div>
      )}
    </form>
  )
}
