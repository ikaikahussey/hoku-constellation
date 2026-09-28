'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { bulkCreateEntities, type BulkRowResult } from '@/app/admin/actions'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { adminEntityHref } from '@/components/admin/links'

type Kind = 'person' | 'org'

const HELP: Record<Kind, { required: string; optional: string; placeholder: string }> = {
  person: {
    required: 'name (or full_name)',
    optional: 'first_name, last_name, slug, aliases (semicolon-separated), entity_types (semicolon-separated), office_held, party, district, island, status, visibility, website_url',
    placeholder: 'name,entity_types,office_held,party,island\nJohn Smith,elected_official,State Senator,Democrat,Oahu',
  },
  org: {
    required: 'name',
    optional: 'slug, aliases (semicolon-separated), org_type, sector, island, status, visibility, website_url, description, ein, dcca, sec_cik, fec_id',
    placeholder: 'name,org_type,sector,island,ein\nHawaiian Electric,utility,energy,Statewide,99-0040500',
  },
}

/** Minimal CSV parser: handles quoted fields with commas and doubled quotes. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(v => v.trim() !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some(v => v.trim() !== '')) rows.push(row)
  if (rows.length < 2) return []
  const headers = rows[0].map(h => h.trim().toLowerCase())
  return rows.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])))
}

export default function BulkCreate() {
  const [kind, setKind] = useState<Kind>('person')
  const [csv, setCsv] = useState('')
  const [preview, setPreview] = useState<Record<string, string>[]>([])
  const [results, setResults] = useState<BulkRowResult[] | null>(null)
  const [error, setError] = useState('')
  const [pending, start] = useTransition()

  function handlePreview() {
    setResults(null); setError('')
    const rows = parseCsv(csv)
    if (!rows.length) { setError('Paste at least a header row and one data row.'); return }
    setPreview(rows)
  }

  function handleCreate() {
    setError('')
    start(async () => {
      const res = await bulkCreateEntities(kind, preview)
      if (!res.ok) { setError(res.error); return }
      setResults(res.results)
      setPreview([])
    })
  }

  const help = HELP[kind]
  const headers = preview.length ? Object.keys(preview[0]) : []
  const created = results?.filter(r => r.ok).length ?? 0
  const failed = results?.filter(r => !r.ok) ?? []

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Bulk create</h1>

      <div className="max-w-4xl space-y-6">
        <div className="flex gap-2" role="tablist" aria-label="Entity kind">
          {(['person', 'org'] as Kind[]).map(k => (
            <Button key={k} role="tab" aria-selected={kind === k} variant={kind === k ? 'primary' : 'secondary'} size="sm" onClick={() => { setKind(k); setPreview([]); setResults(null) }}>
              {k === 'person' ? 'People' : 'Organizations'}
            </Button>
          ))}
        </div>

        <section className="card bg-paper border border-rule p-6 space-y-4">
          <p className="text-sm text-muted">
            Paste CSV with a header row. Required: <span className="font-bold text-ink">{help.required}</span>. Optional: {help.optional}. Slugs are generated from the name when omitted; each row is validated with the same rules as the single-entity form.
          </p>
          <Textarea label="CSV" value={csv} onChange={e => setCsv(e.target.value)} rows={10} placeholder={help.placeholder} className="font-mono text-sm" />
          <Button variant="secondary" onClick={handlePreview} disabled={!csv.trim()}>Preview</Button>
          {error && <p className="text-sm" role="alert">⚠ {error}</p>}
        </section>

        {preview.length > 0 && (
          <section className="card bg-paper border border-rule p-6 space-y-4">
            <h2 className="text-lg font-bold">Preview <span className="text-sm font-normal text-muted">{preview.length} rows{preview.length > 10 ? ', first 10 shown' : ''}</span></h2>
            <div className="overflow-x-auto max-h-72">
              <table className="w-full text-sm tabular">
                <thead>
                  <tr className="border-b border-ink">
                    {headers.map(h => <th key={h} scope="col" className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wide whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 10).map((row, i) => (
                    <tr key={i} className="border-b border-rule">
                      {headers.map(h => <td key={h} className="py-2 px-3">{row[h] || <span className="text-gray-400">—</span>}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button onClick={handleCreate} loading={pending}>Create {preview.length} {kind === 'person' ? (preview.length === 1 ? 'person' : 'people') : (preview.length === 1 ? 'organization' : 'organizations')}</Button>
          </section>
        )}

        {results && (
          <section className="card bg-paper border border-ink p-6 space-y-3">
            <h2 className="text-lg font-bold">Done</h2>
            <p className="text-sm">Created <span className="font-bold">{created}</span> · Failed <span className="font-bold">{failed.length}</span></p>
            {failed.length > 0 && (
              <ul className="text-sm space-y-1">
                {failed.map(r => <li key={r.row}>⚠ Row {r.row} ({r.name || 'unnamed'}): {r.error}</li>)}
              </ul>
            )}
            {created > 0 && (
              <details>
                <summary className="text-sm cursor-pointer">Created entities</summary>
                <ul className="text-sm mt-2 space-y-1">
                  {results.filter(r => r.ok && r.id).map(r => <li key={r.row}><Link href={adminEntityHref(kind, r.id!)}>{r.name}</Link></li>)}
                </ul>
              </details>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
