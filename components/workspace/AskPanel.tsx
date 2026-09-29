'use client'

import { useState } from 'react'
import { buttonClass } from '@/components/ui/Button'
import type { AskResult } from '@/lib/ask'

export function AskPanel({ sources, limit }: { sources: Array<{ key: string; name: string }>; limit: number }) {
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState({ from: '', to: '', source: '' })
  const [res, setRes] = useState<AskResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null); setRes(null)
    const r = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: q, ...filters }) })
    const j = await r.json()
    if (!r.ok) setErr(j.error ?? 'Something went wrong')
    else setRes(j)
    setBusy(false)
  }
  const num = new Map((res?.sources ?? []).map((s, i) => [s.id, i + 1]))
  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-3">
        <label htmlFor="question" className="block text-sm font-bold">Question</label>
        <textarea id="question" value={q} onChange={e => setQ(e.target.value)} rows={3} maxLength={1000} required className="block w-full border border-ink p-3"
          placeholder="Who has contributed to members of the House Finance Committee since 2024?" />
        <div className="grid sm:grid-cols-3 gap-3 text-sm">
          <div><label htmlFor="af" className="block font-bold mb-1">From</label><input id="af" type="date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} className="border border-rule w-full px-2 py-1" /></div>
          <div><label htmlFor="at" className="block font-bold mb-1">To</label><input id="at" type="date" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} className="border border-rule w-full px-2 py-1" /></div>
          <div><label htmlFor="as" className="block font-bold mb-1">Source</label><select id="as" value={filters.source} onChange={e => setFilters({ ...filters, source: e.target.value })} className="border border-rule w-full px-2 py-1"><option value="">All sources</option>{sources.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}</select></div>
        </div>
        <button type="submit" disabled={busy} className={buttonClass('primary', 'sm')}>{busy ? 'Searching the record…' : 'Ask'}</button>
        <p className="text-xs text-muted">{limit} questions per seat per 24 hours. Answers use only HOKU Insider’s records and cite them.</p>
      </form>
      {err && <p role="alert">⚠ {err}</p>}
      {res && (
        <section aria-live="polite" className="space-y-4">
          <h2 className="text-xl font-bold">Answer</h2>
          {res.insufficient && <p className="border border-ink p-3">The records in HOKU Insider do not answer this question{res.answer.length ? '; here is what they do show.' : '.'}</p>}
          {res.answer.length > 0 && <p className="leading-relaxed">{res.answer.map((s, i) => <span key={i}>{s.text}{s.documentIds.map(d => <sup key={d}><a href={`/documents/${d}`} className="link-quiet"> [{num.get(d)}]</a></sup>)} </span>)}</p>}
          {res.answeredBy === 'facts_only' && <p className="text-xs text-muted">Listed directly from the matching records.</p>}
          {res.sources.length > 0 && (
            <div><h3 className="text-sm font-bold uppercase tracking-wide mb-1">Sources</h3>
              <ol className="text-sm space-y-1">{res.sources.map(s => <li key={s.id}>[{num.get(s.id)}] <a href={`/documents/${s.id}`}>{s.title ?? s.source}</a> <span className="text-muted">— {s.source.replace(/_/g, ' ')}{s.doc_date ? `, ${s.doc_date}` : ''}</span></li>)}</ol></div>
          )}
          <p className="text-xs text-muted">{res.remaining} questions left today.</p>
        </section>
      )}
    </div>
  )
}
