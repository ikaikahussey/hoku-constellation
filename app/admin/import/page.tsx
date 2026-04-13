'use client'

import { useState } from 'react'

const DATA_SOURCES = [
  { value: 'state_csc', label: 'Campaign Spending Commission (State)' },
  { value: 'federal_fec', label: 'Federal Election Commission' },
  { value: 'county_honolulu', label: 'City & County of Honolulu' },
  { value: 'ethics_lobbyist_reg', label: 'Ethics Commission - Lobbyist Registrations' },
  { value: 'ethics_lobbyist_exp', label: 'Ethics Commission - Lobbyist Expenditures' },
  { value: 'ethics_disclosure', label: 'Ethics Commission - Financial Disclosures' },
]

export default function AdminImport() {
  const [source, setSource] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<'idle' | 'uploading' | 'processing' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<{ inserted: number; skipped: number; matched: number; unmatched: number } | null>(null)

  async function handleImport(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !source) return

    setStatus('uploading')
    const formData = new FormData()
    formData.append('file', file)
    formData.append('source', source)

    try {
      const res = await fetch('/api/import', { method: 'POST', body: formData })
      const data = await res.json()
      if (res.ok) {
        setResult(data)
        setStatus('done')
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Data Import</h1>

      <div className="max-w-2xl">
        <form onSubmit={handleImport} className="bg-navy-light rounded-lg border border-white/10 p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Data Source</label>
            <select
              required
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white focus:border-gold focus:outline-none"
            >
              <option value="">Select data source...</option>
              {DATA_SOURCES.map((ds) => (
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
            disabled={!file || !source || status === 'uploading' || status === 'processing'}
            className="bg-gold text-navy px-6 py-2.5 rounded-md font-semibold text-sm hover:bg-gold-light disabled:opacity-50"
          >
            {status === 'uploading' ? 'Uploading...' : status === 'processing' ? 'Processing...' : 'Import Data'}
          </button>
        </form>

        {result && status === 'done' && (
          <div className="mt-6 bg-success/10 border border-success/30 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-green-300 mb-2">Import Complete</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <p className="text-white/60">Inserted: <span className="text-white">{result.inserted}</span></p>
              <p className="text-white/60">Skipped: <span className="text-white">{result.skipped}</span></p>
              <p className="text-white/60">Auto-matched: <span className="text-white">{result.matched}</span></p>
              <p className="text-white/60">Unmatched: <span className="text-white">{result.unmatched}</span></p>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="mt-6 bg-error/10 border border-error/30 rounded-lg p-4">
            <p className="text-sm text-red-300">Import failed. Check the file format and try again.</p>
          </div>
        )}
      </div>
    </div>
  )
}
