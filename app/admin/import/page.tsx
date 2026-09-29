'use client'

import { useState } from 'react'
import { SOURCE_REGISTRY, type SourceDefinition, type SourceStatus } from '@/lib/import/source-registry'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { inputClass } from '@/components/ui/Input'
import { formatNumber, humanize } from '@/components/admin/format'

interface RunTotals { documents: number; edges: number; entitiesCreated: number; nextOffset: number | null; done: boolean; batches: number }
interface RunState { status: 'idle' | 'running' | 'done' | 'error'; totals?: RunTotals; error?: string }

const TIER_LABEL: Record<1 | 2 | 3, string> = { 1: 'Tier 1 — core public records', 2: 'Tier 2 — secondary sources', 3: 'Tier 3 — manual or restricted' }
const STATUS_LABEL: Record<SourceStatus, string> = { live: '● Live', planned: '○ Planned', blocked: '⊘ Blocked', manual: '◇ Manual', retired: '× Retired' }

const CSV_SOURCES = SOURCE_REGISTRY.filter(s => s.key === 'employee_compensation' || s.key === 'dcca_breg')

function StatusBadge({ status }: { status: SourceStatus }) {
  return <Badge variant={status === 'live' ? 'solid' : status === 'blocked' || status === 'retired' ? 'muted' : 'outline'}>{STATUS_LABEL[status]}</Badge>
}

function SourceCard({ source, state, onRun }: { source: SourceDefinition; state: RunState; onRun: () => void }) {
  const t = state.totals
  return (
    <div className="card bg-paper border border-rule p-5 flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <h3 className="text-sm font-bold leading-snug">{source.name}</h3>
          <p className="text-xs text-muted mt-1">{source.agency} · {source.jurisdiction} · {humanize(source.cadence)}</p>
          <p className="text-xs text-muted font-mono mt-0.5">{source.key} · {source.accessMethod}</p>
        </div>
        <StatusBadge status={source.status} />
      </div>
      <p className="text-xs text-muted mb-2">
        {source.docTypes.map(humanize).join(', ')} → {source.edgeTypes.map(humanize).join(', ')}
      </p>
      {source.notes && <p className="text-xs text-muted mb-2">{source.notes}</p>}
      {source.secrets?.length ? <p className="text-xs text-muted mb-2">Requires: <span className="font-mono">{source.secrets.join(', ')}</span></p> : null}

      {state.status === 'running' && t && (
        <p className="text-xs border border-rule p-2 mb-2 tabular">● Running · batch {t.batches} · {formatNumber(t.documents)} documents · {formatNumber(t.edges)} edges · {formatNumber(t.entitiesCreated)} entities created · offset {formatNumber(t.nextOffset ?? 0)}</p>
      )}
      {state.status === 'done' && t && (
        <p className="text-xs border border-ink p-2 mb-2 tabular"><span className="font-bold">Complete.</span> {formatNumber(t.documents)} documents · {formatNumber(t.edges)} edges · {formatNumber(t.entitiesCreated)} entities created{t.batches > 1 ? ` · ${t.batches} batches` : ''}</p>
      )}
      {state.status === 'error' && <p className="text-xs border border-ink p-2 mb-2" role="alert">⚠ {state.error ?? 'Import failed'}</p>}

      <div className="mt-auto pt-2">
        {source.status === 'live' ? (
          <Button size="sm" className="w-full" loading={state.status === 'running'} onClick={onRun}>
            {state.status === 'running' ? 'Running…' : state.status === 'done' ? 'Run again' : 'Run'}
          </Button>
        ) : (
          <p className="text-xs text-muted">{source.status === 'manual' ? 'Upload a CSV below.' : 'No importer for this source yet.'}</p>
        )}
      </div>
    </div>
  )
}

export default function AdminImport() {
  const [runs, setRuns] = useState<Record<string, RunState>>({})
  const [csvSource, setCsvSource] = useState(CSV_SOURCES[0]?.key ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [csvStatus, setCsvStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')
  const [csvResult, setCsvResult] = useState<Record<string, unknown> | null>(null)
  const [csvError, setCsvError] = useState('')

  const setRun = (key: string, patch: Partial<RunState>) => setRuns(prev => ({ ...prev, [key]: { ...(prev[key] ?? { status: 'idle' }), ...patch } }))

  async function run(key: string) {
    const totals: RunTotals = { documents: 0, edges: 0, entitiesCreated: 0, nextOffset: null, done: false, batches: 0 }
    setRun(key, { status: 'running', totals: { ...totals }, error: undefined })
    let offset: number | undefined
    try {
      // Batched sources return done=false with nextOffset; loop until done.
      for (;;) {
        const res = await fetch('/api/admin/import-source', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(offset === undefined ? { source: key } : { source: key, offset }),
        })
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (!res.ok) { setRun(key, { status: 'error', error: typeof data.error === 'string' ? data.error : `Request failed: ${res.status}` }); return }
        totals.batches += 1
        totals.documents += Number(data.documents ?? 0)
        totals.edges += Number(data.edges ?? 0)
        totals.entitiesCreated += Number(data.entitiesCreated ?? 0)
        totals.nextOffset = typeof data.nextOffset === 'number' ? data.nextOffset : null
        totals.done = data.done !== false
        setRun(key, { status: 'running', totals: { ...totals } })
        if (totals.done || totals.nextOffset === null || totals.nextOffset === offset) break
        offset = totals.nextOffset
      }
      setRun(key, { status: 'done', totals: { ...totals, done: true } })
    } catch (err) {
      setRun(key, { status: 'error', error: err instanceof Error ? err.message : 'Network error' })
    }
  }

  async function uploadCsv(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !csvSource) return
    setCsvStatus('uploading'); setCsvError(''); setCsvResult(null)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('source', csvSource)
    try {
      const res = await fetch('/api/import', { method: 'POST', body: fd })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) { setCsvStatus('error'); setCsvError(typeof data.error === 'string' ? data.error : `Request failed: ${res.status}`); return }
      setCsvResult(data); setCsvStatus('done')
    } catch (err) {
      setCsvStatus('error'); setCsvError(err instanceof Error ? err.message : 'Network error')
    }
  }

  const tiers: Array<1 | 2 | 3> = [1, 2, 3]

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Data import</h1>
        <p className="text-sm text-muted mt-1">
          Every registered source, grouped by tier. Live sources run through <span className="font-mono">/api/admin/import-source</span>; batched sources loop until the API reports done.
        </p>
      </div>

      {tiers.map(tier => {
        const sources = SOURCE_REGISTRY.filter(s => s.tier === tier)
        if (!sources.length) return null
        const live = sources.filter(s => s.status === 'live').length
        return (
          <section key={tier} className="mb-10">
            <h2 className="text-lg font-bold mb-1">{TIER_LABEL[tier]}</h2>
            <p className="text-xs text-muted mb-4">{sources.length} sources · {live} live</p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {sources.map(s => <SourceCard key={s.key} source={s} state={runs[s.key] ?? { status: 'idle' }} onRun={() => run(s.key)} />)}
            </div>
          </section>
        )
      })}

      <section className="mb-8">
        <h2 className="text-lg font-bold mb-1">Upload a CSV</h2>
        <p className="text-xs text-muted mb-4">For sources obtained by request (UIPA). Rows become documents and edges with unmatched names routed to Match Review.</p>
        <div className="max-w-2xl">
          <form onSubmit={uploadCsv} className="card bg-paper border border-rule p-6 space-y-4">
            <label className="block text-sm">
              <span className="block font-bold mb-1">Data source</span>
              <select required value={csvSource} onChange={e => setCsvSource(e.target.value)} className={inputClass}>
                {CSV_SOURCES.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="block font-bold mb-1">CSV file</span>
              <input type="file" accept=".csv,text/csv" onChange={e => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm file:mr-4 file:border file:border-ink file:bg-paper file:px-3 file:py-1.5 file:text-sm file:font-bold" />
            </label>
            <Button type="submit" disabled={!file || !csvSource} loading={csvStatus === 'uploading'}>Import CSV</Button>
          </form>

          {csvStatus === 'done' && csvResult && (
            <div className="mt-4 border border-ink p-4 text-sm">
              <h3 className="font-bold mb-2">Import complete</h3>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 tabular">
                {Object.entries(csvResult).filter(([, v]) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean').map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 border-b border-rule py-0.5"><dt className="text-muted">{humanize(k)}</dt><dd>{typeof v === 'number' ? formatNumber(v) : String(v)}</dd></div>
                ))}
              </dl>
            </div>
          )}
          {csvStatus === 'error' && <p className="mt-4 border border-ink p-4 text-sm" role="alert">⚠ {csvError || 'Import failed. Check the file format and try again.'}</p>}
        </div>
      </section>
    </div>
  )
}
