'use client'

import { useState, useEffect, useCallback } from 'react'

const CSV_SOURCES = [
  { value: 'state_csc', label: 'Campaign Spending Commission (State)' },
  { value: 'federal_fec', label: 'Federal Election Commission' },
  { value: 'county_honolulu', label: 'City & County of Honolulu' },
  { value: 'ethics_lobbyist_reg', label: 'Ethics Commission - Lobbyist Registrations' },
  { value: 'ethics_lobbyist_exp', label: 'Ethics Commission - Lobbyist Expenditures' },
  { value: 'ethics_disclosure', label: 'Ethics Commission - Financial Disclosures' },
]

const LIVE_SOURCES = [
  {
    key: 'hawaii_csc',
    label: 'Hawaii Campaign Spending Commission',
    description: 'Campaign contribution records from opendata.hawaii.gov',
    icon: '\u{1F3DB}',
  },
  {
    key: 'fec',
    label: 'Federal Election Commission',
    description: 'Contributions for Schatz, Hirono & Case from FEC API',
    icon: '\u{1F1FA}\u{1F1F8}',
  },
  {
    key: 'lobbyist',
    label: 'Lobbyist Registrations',
    description: 'Lobbyist registration data from Hawaii Ethics Commission',
    icon: '\u{1F4CB}',
  },
  {
    key: 'puc',
    label: 'PUC Dockets',
    description: 'Public Utilities Commission docket records',
    icon: '\u26A1',
  },
]

type SourcePreview = {
  source_total: number | string
  db_count: number
  delta: number | string
  note?: string
}

type ImportState = {
  status: 'idle' | 'previewing' | 'running' | 'done' | 'error'
  preview?: SourcePreview
  result?: Record<string, unknown>
  error?: string
}

type ImportStatus = Record<string, ImportState>

type DataStats = {
  contributions: { total: number; by_source: Record<string, number> }
  lobbyist_registrations: number
  puc_dockets: number
} | null

export default function AdminImport() {
  const [csvSource, setCsvSource] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [csvStatus, setCsvStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')
  const [csvResult, setCsvResult] = useState<{ inserted: number; skipped: number; matched: number; unmatched: number } | null>(null)

  const [importStatus, setImportStatus] = useState<ImportStatus>(
    Object.fromEntries(LIVE_SOURCES.map(s => [s.key, { status: 'idle' as const }]))
  )

  const [stats, setStats] = useState<DataStats>(null)

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/import-source')
      if (res.ok) setStats(await res.json())
    } catch { /* ignore */ }
  }, [])

  // Fetch previews for all sources on mount
  const fetchPreviews = useCallback(async () => {
    for (const source of LIVE_SOURCES) {
      setImportStatus(prev => ({
        ...prev,
        [source.key]: { ...prev[source.key], status: 'previewing' },
      }))
      try {
        const res = await fetch(`/api/admin/import-source?preview=${source.key}`)
        if (res.ok) {
          const data = await res.json()
          setImportStatus(prev => ({
            ...prev,
            [source.key]: {
              ...prev[source.key],
              status: 'idle',
              preview: {
                source_total: data.source_total,
                db_count: data.db_count,
                delta: data.delta,
                note: data.note,
              },
            },
          }))
        } else {
          setImportStatus(prev => ({
            ...prev,
            [source.key]: { ...prev[source.key], status: 'idle' },
          }))
        }
      } catch {
        setImportStatus(prev => ({
          ...prev,
          [source.key]: { ...prev[source.key], status: 'idle' },
        }))
      }
    }
  }, [])

  useEffect(() => {
    fetchStats()
    fetchPreviews()
  }, [fetchStats, fetchPreviews])

  async function handleCsvImport(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !csvSource) return

    setCsvStatus('uploading')
    const formData = new FormData()
    formData.append('file', file)
    formData.append('source', csvSource)

    try {
      const res = await fetch('/api/import', { method: 'POST', body: formData })
      const data = await res.json()
      if (res.ok) {
        setCsvResult(data)
        setCsvStatus('done')
        fetchStats()
        fetchPreviews()
      } else {
        setCsvStatus('error')
      }
    } catch {
      setCsvStatus('error')
    }
  }

  async function triggerLiveImport(sourceKey: string) {
    setImportStatus(prev => ({
      ...prev,
      [sourceKey]: { ...prev[sourceKey], status: 'running' },
    }))

    try {
      const res = await fetch('/api/admin/import-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: sourceKey }),
      })
      const data = await res.json()

      if (res.ok) {
        setImportStatus(prev => ({
          ...prev,
          [sourceKey]: { ...prev[sourceKey], status: 'done', result: data },
        }))
        fetchStats()
        fetchPreviews()
      } else {
        setImportStatus(prev => ({
          ...prev,
          [sourceKey]: { ...prev[sourceKey], status: 'error', error: data.error || 'Import failed' },
        }))
      }
    } catch (err) {
      setImportStatus(prev => ({
        ...prev,
        [sourceKey]: { ...prev[sourceKey], status: 'error', error: err instanceof Error ? err.message : 'Network error' },
      }))
    }
  }

  function formatNum(val: number | string) {
    return typeof val === 'number' ? val.toLocaleString() : String(val)
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Data Import</h1>

      {/* Current Data Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-navy-light rounded-lg border border-white/10 p-4">
            <p className="text-2xl font-bold text-gold">{stats.contributions.total.toLocaleString()}</p>
            <p className="text-sm text-white/50">Total Contributions</p>
            {Object.entries(stats.contributions.by_source).length > 0 && (
              <div className="mt-2 space-y-1">
                {Object.entries(stats.contributions.by_source).map(([src, count]) => (
                  <p key={src} className="text-xs text-white/30">
                    {src}: {count.toLocaleString()}
                  </p>
                ))}
              </div>
            )}
          </div>
          <div className="bg-navy-light rounded-lg border border-white/10 p-4">
            <p className="text-2xl font-bold text-gold">{stats.lobbyist_registrations.toLocaleString()}</p>
            <p className="text-sm text-white/50">Lobbyist Registrations</p>
          </div>
          <div className="bg-navy-light rounded-lg border border-white/10 p-4">
            <p className="text-2xl font-bold text-gold">{stats.puc_dockets.toLocaleString()}</p>
            <p className="text-sm text-white/50">PUC Dockets</p>
          </div>
        </div>
      )}

      {/* Live API Imports */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">Import from Government Data Sources</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {LIVE_SOURCES.map((source) => {
            const state = importStatus[source.key]
            const preview = state?.preview
            const deltaVal = preview ? preview.delta : null
            const hasNewRecords = typeof deltaVal === 'number' && deltaVal > 0
            const isSynced = typeof deltaVal === 'number' && deltaVal <= 0

            return (
              <div
                key={source.key}
                className="bg-navy-light rounded-lg border border-white/10 p-5"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                      <span>{source.icon}</span>
                      {source.label}
                    </h3>
                    <p className="text-xs text-white/40 mt-1">{source.description}</p>
                  </div>
                </div>

                {/* Delta / Sync Status */}
                {state?.status === 'previewing' && (
                  <div className="flex items-center gap-2 mb-3 py-2">
                    <div className="h-3 w-3 rounded-full bg-white/20 animate-pulse" />
                    <span className="text-xs text-white/40">Checking source...</span>
                  </div>
                )}

                {preview && state?.status !== 'previewing' && (
                  <div className={`rounded p-3 mb-3 ${
                    hasNewRecords
                      ? 'bg-blue-900/20 border border-blue-500/20'
                      : isSynced
                        ? 'bg-green-900/20 border border-green-500/20'
                        : 'bg-white/5 border border-white/10'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="text-xs space-y-1">
                        <p className="text-white/50">
                          Source: <span className="text-white font-medium">{formatNum(preview.source_total)}</span>
                        </p>
                        <p className="text-white/50">
                          In DB: <span className="text-white font-medium">{preview.db_count.toLocaleString()}</span>
                        </p>
                      </div>
                      <div className="text-right">
                        {hasNewRecords && (
                          <p className="text-sm font-bold text-blue-300">
                            +{formatNum(deltaVal)}
                            <span className="text-xs font-normal text-blue-300/60 block">new records</span>
                          </p>
                        )}
                        {isSynced && (
                          <p className="text-xs font-medium text-green-400">
                            Up to date
                          </p>
                        )}
                        {typeof deltaVal === 'string' && (
                          <p className="text-xs text-white/40">{deltaVal}</p>
                        )}
                      </div>
                    </div>
                    {preview.note && (
                      <p className="text-xs text-white/30 mt-2">{preview.note}</p>
                    )}
                  </div>
                )}

                {/* Import result */}
                {state?.status === 'done' && state.result && (
                  <div className="bg-green-900/20 border border-green-500/20 rounded p-3 mb-3">
                    <p className="text-xs text-green-300 font-medium">Import complete</p>
                    <div className="text-xs text-white/50 mt-1">
                      {state.result.inserted !== undefined && (
                        <span>Inserted: {String(state.result.inserted)}</span>
                      )}
                      {state.result.total !== undefined && (
                        <span className="ml-3">Fetched: {String(state.result.total)}</span>
                      )}
                      {typeof state.result.note === 'string' && (
                        <p className="mt-1">{state.result.note}</p>
                      )}
                    </div>
                  </div>
                )}

                {state?.status === 'error' && (
                  <div className="bg-red-900/20 border border-red-500/20 rounded p-3 mb-3">
                    <p className="text-xs text-red-300">{state.error || 'Import failed'}</p>
                  </div>
                )}

                <button
                  onClick={() => triggerLiveImport(source.key)}
                  disabled={state?.status === 'running' || state?.status === 'previewing'}
                  className={`w-full px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    hasNewRecords
                      ? 'bg-blue-600/20 text-blue-300 hover:bg-blue-600/30'
                      : 'bg-gold/10 text-gold hover:bg-gold/20'
                  }`}
                >
                  {state?.status === 'running' ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Importing...
                    </span>
                  ) : state?.status === 'done' ? (
                    'Re-import'
                  ) : hasNewRecords ? (
                    `Import ${formatNum(deltaVal)} new records`
                  ) : isSynced ? (
                    'Re-sync'
                  ) : (
                    'Start Import'
                  )}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* CSV File Upload */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">Upload CSV File</h2>
        <div className="max-w-2xl">
          <form onSubmit={handleCsvImport} className="bg-navy-light rounded-lg border border-white/10 p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">Data Source</label>
              <select
                required
                value={csvSource}
                onChange={(e) => setCsvSource(e.target.value)}
                className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white focus:border-gold focus:outline-none"
              >
                <option value="">Select data source...</option>
                {CSV_SOURCES.map((ds) => (
                  <option key={ds.value} value={ds.value}>{ds.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">CSV File</label>
              <input
                type="file"
                accept=".csv"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-white/60 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-gold/10 file:text-gold hover:file:bg-gold/20"
              />
            </div>

            <button
              type="submit"
              disabled={!file || !csvSource || csvStatus === 'uploading'}
              className="bg-gold text-navy px-6 py-2.5 rounded-md font-semibold text-sm hover:bg-gold-light disabled:opacity-50"
            >
              {csvStatus === 'uploading' ? 'Uploading...' : 'Import CSV'}
            </button>
          </form>

          {csvResult && csvStatus === 'done' && (
            <div className="mt-4 bg-green-900/20 border border-green-500/20 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-green-300 mb-2">Import Complete</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <p className="text-white/60">Inserted: <span className="text-white">{csvResult.inserted}</span></p>
                <p className="text-white/60">Skipped: <span className="text-white">{csvResult.skipped}</span></p>
                <p className="text-white/60">Auto-matched: <span className="text-white">{csvResult.matched}</span></p>
                <p className="text-white/60">Unmatched: <span className="text-white">{csvResult.unmatched}</span></p>
              </div>
            </div>
          )}

          {csvStatus === 'error' && (
            <div className="mt-4 bg-red-900/20 border border-red-500/20 rounded-lg p-4">
              <p className="text-sm text-red-300">Import failed. Check the file format and try again.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
