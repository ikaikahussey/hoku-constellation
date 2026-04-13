'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { slugify } from '@/lib/slugify'

export default function BulkCreate() {
  const [entityType, setEntityType] = useState<'person' | 'organization'>('person')
  const [csvText, setCsvText] = useState('')
  const [preview, setPreview] = useState<Record<string, string>[]>([])
  const [status, setStatus] = useState<'idle' | 'previewing' | 'creating' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<{ created: number; errors: number }>({ created: 0, errors: 0 })

  function handlePreview() {
    const lines = csvText.trim().split('\n')
    if (lines.length < 2) return

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
    const rows = lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim())
      const obj: Record<string, string> = {}
      headers.forEach((h, i) => { obj[h] = values[i] || '' })
      return obj
    })

    setPreview(rows)
    setStatus('previewing')
  }

  async function handleCreate() {
    setStatus('creating')
    const supabase = createClient()
    let created = 0
    let errors = 0

    for (const row of preview) {
      if (entityType === 'person') {
        const { error } = await supabase.from('person').insert({
          full_name: row.full_name || row.name || '',
          first_name: row.first_name || '',
          last_name: row.last_name || '',
          slug: slugify(row.full_name || row.name || ''),
          entity_types: (row.entity_types || row.type || '').split(';').map(t => t.trim()).filter(Boolean),
          office_held: row.office_held || row.office || null,
          party: row.party || null,
          district: row.district || null,
          island: row.island || null,
          status: row.status || 'active',
        })
        if (error) errors++
        else created++
      } else {
        const { error } = await supabase.from('organization').insert({
          name: row.name || '',
          slug: slugify(row.name || ''),
          org_type: row.org_type || row.type || 'other',
          sector: row.sector || null,
          island: row.island || null,
          status: row.status || 'active',
        })
        if (error) errors++
        else created++
      }
    }

    setResult({ created, errors })
    setStatus('done')
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Bulk Create</h1>

      <div className="max-w-3xl space-y-6">
        <div className="flex gap-4">
          <button
            onClick={() => setEntityType('person')}
            className={`px-4 py-2 rounded-md text-sm ${entityType === 'person' ? 'bg-gold text-navy font-semibold' : 'text-white/50 bg-white/5'}`}
          >
            People
          </button>
          <button
            onClick={() => setEntityType('organization')}
            className={`px-4 py-2 rounded-md text-sm ${entityType === 'organization' ? 'bg-gold text-navy font-semibold' : 'text-white/50 bg-white/5'}`}
          >
            Organizations
          </button>
        </div>

        <div className="bg-navy-light rounded-lg border border-white/10 p-6 space-y-4">
          <p className="text-sm text-white/50">
            Paste CSV data below. First row should be headers.
            {entityType === 'person'
              ? ' Required: full_name. Optional: first_name, last_name, entity_types (semicolon-separated), office_held, party, district, island, status.'
              : ' Required: name. Optional: org_type, sector, island, status.'}
          </p>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            rows={10}
            placeholder={entityType === 'person'
              ? 'full_name,entity_types,office_held,party,island\nJohn Smith,elected_official,State Senator,Democrat,Oahu'
              : 'name,org_type,sector,island\nHawaiian Electric,utility,energy,Statewide'}
            className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white font-mono text-sm focus:border-gold focus:outline-none"
          />
          <button onClick={handlePreview} className="bg-gold text-navy px-4 py-2 rounded-md text-sm font-semibold hover:bg-gold-light">
            Preview
          </button>
        </div>

        {status === 'previewing' && preview.length > 0 && (
          <div className="bg-navy-light rounded-lg border border-white/10 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white">Preview ({preview.length} records)</h2>
            <div className="overflow-x-auto max-h-64">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    {Object.keys(preview[0]).map(key => (
                      <th key={key} className="text-left py-2 px-3 text-white/50 font-medium">{key}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 10).map((row, i) => (
                    <tr key={i} className="border-b border-white/5">
                      {Object.values(row).map((val, j) => (
                        <td key={j} className="py-2 px-3 text-white/70">{val}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={handleCreate} className="bg-gold text-navy px-6 py-2.5 rounded-md font-semibold text-sm hover:bg-gold-light">
              Create {preview.length} {entityType === 'person' ? 'People' : 'Organizations'}
            </button>
          </div>
        )}

        {status === 'done' && (
          <div className="bg-success/10 border border-success/30 rounded-lg p-4">
            <p className="text-sm text-green-300">Created: {result.created} | Errors: {result.errors}</p>
          </div>
        )}
      </div>
    </div>
  )
}
