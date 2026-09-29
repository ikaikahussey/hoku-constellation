'use client'

import { useEffect, useState } from 'react'

interface Hit { id: string; kind: string; name: string; subtitle: string | null }

/**
 * Search box that fills a hidden input with the chosen entity id (bills, people, organizations,
 * committees). Uses the public /api/search endpoint.
 */
export function EntityPicker({ name = 'value', kind, label = 'Search', placeholder = 'Bill number, person, or organization' }: { name?: string; kind?: string; label?: string; placeholder?: string }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [chosen, setChosen] = useState<Hit | null>(null)
  const active = q.trim().length >= 2 && chosen?.name !== q
  const shown = active ? hits : []
  useEffect(() => {
    if (!active) return
    const ctl = new AbortController()
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}&limit=8${kind ? `&type=${kind}` : ''}`, { signal: ctl.signal })
        .then(r => r.json()).then(j => setHits(j.results ?? [])).catch(() => {})
    }, 200)
    return () => { clearTimeout(t); ctl.abort() }
  }, [q, kind, active])
  const id = `picker-${name}`
  return (
    <div className="relative">
      <label htmlFor={id} className="block text-sm font-bold mb-1">{label}</label>
      <input id={id} value={q} onChange={e => { setQ(e.target.value); setChosen(null) }} placeholder={placeholder} autoComplete="off"
        role="combobox" aria-expanded={shown.length > 0} aria-controls={`${id}-list`}
        className="block w-full border border-ink bg-paper px-3 py-2 text-ink placeholder:text-muted focus:outline-none" />
      <input type="hidden" name={name} value={chosen?.id ?? ''} />
      {shown.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="absolute z-20 left-0 right-0 bg-paper border border-ink border-t-0 max-h-72 overflow-auto">
          {shown.map(h => (
            <li key={h.id} role="option" aria-selected={chosen?.id === h.id}>
              <button type="button" onClick={() => { setChosen(h); setQ(h.name); setHits([]) }} className="w-full text-left px-3 py-2 hover:bg-gray-100 focus:bg-gray-100">
                <span className="font-bold">{h.name}</span> <span className="text-xs text-muted uppercase">{h.kind}</span>
                {h.subtitle && <span className="block text-xs text-muted">{h.subtitle}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {chosen && <p className="text-xs text-muted mt-1">Selected: {chosen.name}</p>}
    </div>
  )
}
