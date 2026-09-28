'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { resolveEdgeMatch } from '@/app/admin/actions'
import { Button } from '@/components/ui/Button'
import { inputClass } from '@/components/ui/Input'
import { adminEntityHref } from './links'

export interface Candidate { id: string; name: string; kind: string; confidence: number }

interface Props {
  edgeId: string
  side: 'from' | 'to'
  rawName: string
  candidates: Candidate[]
}

/** Link/unmatched controls for one unresolved side of an edge. */
export function MatchReviewActions({ edgeId, side, rawName, candidates }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState('')
  const [manualId, setManualId] = useState('')

  function run(entityId: string | null, status: 'matched' | 'unmatched') {
    setError('')
    start(async () => {
      const res = await resolveEdgeMatch(edgeId, side, entityId, status)
      if (!res.ok) { setError(res.error); return }
      router.refresh()
    })
  }

  return (
    <div className="border-t border-rule pt-3 mt-3">
      <p className="text-xs text-muted uppercase tracking-wide mb-1">{side === 'from' ? 'From' : 'To'} · unresolved</p>
      <p className="font-bold mb-2">{rawName}</p>
      {candidates.length === 0 ? (
        <p className="text-sm text-muted mb-2">No fuzzy candidates above the review threshold.</p>
      ) : (
        <ul className="space-y-1 mb-2">
          {candidates.map(c => (
            <li key={c.id} className="flex items-center justify-between gap-3 text-sm">
              <span>
                <Link href={adminEntityHref(c.kind, c.id)}>{c.name}</Link>
                <span className="text-muted"> · {c.kind} · {Math.round(c.confidence * 100)}%</span>
              </span>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(c.id, 'matched')}>Link</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <input
          value={manualId}
          onChange={e => setManualId(e.target.value)}
          placeholder="Or paste an entity id"
          aria-label="Entity id"
          className={`${inputClass} sm:max-w-xs font-mono text-xs py-1.5`}
        />
        <Button size="sm" variant="secondary" disabled={pending || !manualId.trim()} onClick={() => run(manualId.trim(), 'matched')}>Link id</Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(null, 'unmatched')}>Mark unmatched</Button>
      </div>
      {error && <p className="mt-2 text-sm" role="alert">⚠ {error}</p>}
    </div>
  )
}
