'use client'

import { useEffect, useOptimistic, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { inputClass } from '@/components/ui/Input'
import { exploreUrl, toggle, type ExploreFacets, type ExploreFilters, type FacetOption } from '@/lib/explore/filters'
import type { TagTreeBranch } from '@/lib/entity-tags'

const n = (x: number) => x.toLocaleString('en-US')

type Go = (patch: Partial<ExploreFilters>) => void

/** Top bar: name filter, type, sort. */
export function ExploreSearchBar({ filters, facets }: { filters: ExploreFilters; facets: ExploreFacets }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
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

  const go: Go = patch => startTransition(() => router.replace(exploreUrl(filters, patch), { scroll: false }))

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
        onClick={() => go({ kind: value, ...(value === 'person' ? { orgTypes: [], sectors: [] } : {}) })}
        className={`px-3 py-2 text-sm border border-ink -ml-px first:ml-0 ${active ? 'bg-ink text-paper font-bold' : 'bg-paper text-ink'}`}
      >
        {label} <span className="tabular">{n(count)}</span>
      </button>
    )
  }

  return (
    <form role="search" aria-label="Filter by name" onSubmit={e => { e.preventDefault(); setPushed(q.trim()); go({ q: q.trim() }) }}
      className="flex flex-col lg:flex-row gap-3 lg:items-end">
      <div className="flex-1 min-w-0">
        <label htmlFor="explore-q" className="block text-xs font-bold uppercase tracking-wide mb-1">Name</label>
        <input id="explore-q" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by name or alias" autoComplete="off" className={inputClass} />
      </div>
      <div className="flex flex-wrap gap-3 items-end">
        <div role="group" aria-label="Type" className="flex">
          {kindButton(null, 'All', facets.kind.person + facets.kind.org)}
          {kindButton('person', 'People', facets.kind.person)}
          {kindButton('org', 'Organizations', facets.kind.org)}
        </div>
        <div>
          <label htmlFor="explore-sort" className="sr-only">Sort</label>
          <select id="explore-sort" value={filters.sort} onChange={e => go({ sort: e.target.value as ExploreFilters['sort'] })} className={`${inputClass} text-sm`}>
            <option value="name">Name A–Z</option>
            <option value="updated">Recently updated</option>
            <option value="added">Recently added</option>
          </select>
        </div>
      </div>
    </form>
  )
}

function Check({ checked, indeterminate, onChange, label, count, bold }: {
  checked: boolean; indeterminate?: boolean; onChange: () => void; label: string; count: number | null; bold?: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate && !checked }, [indeterminate, checked])
  return (
    <label className={`flex items-baseline gap-2 py-0.5 text-sm cursor-pointer ${count === 0 && !checked ? 'text-muted' : ''}`}>
      <input ref={ref} type="checkbox" checked={checked} onChange={onChange} className="accent-ink translate-y-px" />
      <span className={`flex-1 min-w-0 ${bold ? 'font-bold' : ''}`}>{label}</span>
      {count !== null && count >= 0 && <span className="text-xs text-muted tabular">{n(count)}</span>}
    </label>
  )
}

function Group({ title, children, id }: { title: string; children: React.ReactNode; id: string }) {
  return (
    <fieldset className="mb-6" aria-labelledby={id}>
      <legend id={id} className="text-xs font-bold uppercase tracking-wide mb-2 pb-1 border-b border-ink w-full">{title}</legend>
      {children}
    </fieldset>
  )
}

function CheckList({ options, selected, onToggle, limit = 8 }: {
  options: FacetOption[]; selected: string[]; onToggle: (v: string) => void; limit?: number
}) {
  const [all, setAll] = useState(false)
  if (!options.length) return <p className="text-sm text-muted">None</p>
  const shown = all ? options : options.filter((o, i) => i < limit || selected.includes(o.value))
  return (
    <>
      {shown.map(o => <Check key={o.value} checked={selected.includes(o.value)} onChange={() => onToggle(o.value)} label={o.label} count={o.count} />)}
      {options.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="text-sm underline mt-1">Show all {options.length}</button>
      )}
    </>
  )
}

function TagTree({ tree, filters, go }: { tree: TagTreeBranch[]; filters: ExploreFilters; go: Go }) {
  const sel = filters.tags
  const setTags = (tags: string[]) => go({ tags })
  if (!tree.length) return <p className="text-sm text-muted">No tags</p>
  return (
    <>
      <div role="radiogroup" aria-label="Tag match" className="flex mb-3 text-xs">
        {(['any', 'all'] as const).map(m => (
          <button key={m} type="button" role="radio" aria-checked={filters.match === m} onClick={() => go({ match: m })}
            className={`px-2 py-1 border border-ink -ml-px first:ml-0 ${filters.match === m ? 'bg-ink text-paper font-bold' : 'bg-paper text-ink'}`}>
            Match {m}
          </button>
        ))}
      </div>
      <ul className="space-y-2">
        {tree.map(b => {
          const branchSelectable = b.count >= 0
          const branchOn = sel.includes(b.value)
          const childKeys = b.tags.map(t => t.value)
          const someChild = childKeys.some(k => sel.includes(k))
          return (
            <li key={b.value}>
              {branchSelectable ? (
                <Check bold checked={branchOn} indeterminate={someChild} label={b.label} count={b.count}
                  onChange={() => setTags(branchOn ? sel.filter(t => t !== b.value) : [...sel.filter(t => !childKeys.includes(t)), b.value])} />
              ) : (
                <p className="text-sm font-bold py-0.5">{b.label}</p>
              )}
              <ul className="pl-5">
                {b.tags.map(t => (
                  <li key={t.value}>
                    <Check checked={branchOn || sel.includes(t.value)} label={t.label} count={t.count}
                      onChange={() => {
                        // Unchecking one tag inside a selected branch keeps its siblings.
                        if (branchOn) setTags([...sel.filter(x => x !== b.value), ...childKeys.filter(k => k !== t.value)])
                        else setTags(toggle(sel, t.value))
                      }} />
                  </li>
                ))}
              </ul>
            </li>
          )
        })}
      </ul>
    </>
  )
}

/** Sidebar: multi-select facets. Options within a facet are OR'd; tags can be OR'd or AND'd. */
export function ExploreFacetPanel({ filters: serverFilters, facets, activeCount }: { filters: ExploreFilters; facets: ExploreFacets; activeCount: number }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  // Checkboxes reflect a click at once; the server render catches up. Rapid clicks build on each other.
  const [filters, setOptimistic] = useOptimistic(serverFilters, (cur: ExploreFilters, patch: Partial<ExploreFilters>) => ({ ...cur, ...patch, page: 1 }))
  const go: Go = patch => startTransition(() => {
    setOptimistic(patch)
    router.replace(exploreUrl(filters, patch), { scroll: false })
  })
  const orgFacets = filters.kind !== 'person'
  return (
    <>
    <button type="button" aria-expanded={open} aria-controls="explore-facets" onClick={() => setOpen(o => !o)}
      className="md:hidden w-full text-left mb-4 border border-ink px-3 py-2 text-sm font-bold">
      {open ? 'Hide filters' : 'Show filters'}{activeCount ? ` (${activeCount} active)` : ''}
    </button>
    <div id="explore-facets" aria-busy={pending} className={open ? 'block' : 'hidden md:block'}>
      <Group title="Tags" id="facet-tags"><TagTree tree={facets.tags} filters={filters} go={go} /></Group>
      <Group title="Island" id="facet-island"><CheckList options={facets.islands} selected={filters.islands} onToggle={v => go({ islands: toggle(filters.islands, v) })} /></Group>
      {orgFacets && <Group title="Organization type" id="facet-org-type"><CheckList options={facets.orgTypes} selected={filters.orgTypes} onToggle={v => go({ orgTypes: toggle(filters.orgTypes, v) })} /></Group>}
      {orgFacets && <Group title="Sector" id="facet-sector"><CheckList options={facets.sectors} selected={filters.sectors} onToggle={v => go({ sectors: toggle(filters.sectors, v) })} /></Group>}
      <Group title="Status" id="facet-status"><CheckList options={facets.statuses} selected={filters.statuses} onToggle={v => go({ statuses: toggle(filters.statuses, v) })} /></Group>
    </div>
    </>
  )
}
