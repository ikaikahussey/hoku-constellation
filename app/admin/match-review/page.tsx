'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

interface UnmatchedContribution {
  id: string
  donor_name_raw: string
  recipient_name_raw: string
  amount: number
  contribution_date: string | null
  match_status: string
  match_confidence: number | null
}

export default function MatchReview() {
  const [records, setRecords] = useState<UnmatchedContribution[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadRecords()
  }, [])

  async function loadRecords() {
    const supabase = createClient()
    const { data } = await supabase
      .from('contribution')
      .select('id, donor_name_raw, recipient_name_raw, amount, contribution_date, match_status, match_confidence')
      .in('match_status', ['unmatched', 'auto_matched'])
      .order('amount', { ascending: false })
      .limit(50)
    setRecords(data || [])
    setLoading(false)
  }

  async function updateMatch(id: string, status: string) {
    const supabase = createClient()
    await supabase.from('contribution').update({ match_status: status }).eq('id', id)
    setRecords((prev) => prev.filter((r) => r.id !== id || status !== 'manually_matched'))
    loadRecords()
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Match Review</h1>
      <p className="text-sm text-white/50 mb-6">
        Review auto-matched and unmatched contribution records. Approve, reject, or re-link matches.
      </p>

      <div className="space-y-4">
        {loading ? (
          <p className="text-white/40">Loading...</p>
        ) : records.length === 0 ? (
          <div className="bg-navy-light rounded-lg border border-white/10 p-12 text-center">
            <p className="text-white/40">No records to review. All caught up!</p>
          </div>
        ) : (
          records.map((record) => (
            <div key={record.id} className="bg-navy-light rounded-lg border border-white/10 p-4">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-sm">
                    <span className="text-white/50">Donor:</span>{' '}
                    <span className="text-white font-medium">{record.donor_name_raw}</span>
                  </p>
                  <p className="text-sm">
                    <span className="text-white/50">Recipient:</span>{' '}
                    <span className="text-white font-medium">{record.recipient_name_raw}</span>
                  </p>
                  <p className="text-sm text-white/50">
                    ${Number(record.amount).toLocaleString()} &middot; {record.contribution_date || 'No date'}
                  </p>
                  {record.match_confidence !== null && (
                    <p className="text-xs">
                      <span className="text-white/40">Confidence:</span>{' '}
                      <span className={record.match_confidence >= 0.85 ? 'text-green-400' : 'text-yellow-400'}>
                        {(record.match_confidence * 100).toFixed(0)}%
                      </span>
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    record.match_status === 'auto_matched' ? 'bg-gold/10 text-gold' : 'bg-white/10 text-white/50'
                  }`}>
                    {record.match_status.replace(/_/g, ' ')}
                  </span>
                  <button
                    onClick={() => updateMatch(record.id, 'manually_matched')}
                    className="text-xs bg-success/20 text-green-300 px-3 py-1.5 rounded hover:bg-success/30"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => updateMatch(record.id, 'rejected')}
                    className="text-xs bg-error/20 text-red-300 px-3 py-1.5 rounded hover:bg-error/30"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
