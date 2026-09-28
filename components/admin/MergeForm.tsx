'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { mergeEntity } from '@/app/admin/actions'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

/** Merge this entity into another: repoints every edge and marks this row merged. */
export function MergeForm({ fromId, fromName }: { fromId: string; fromName: string }) {
  const router = useRouter()
  const [intoId, setIntoId] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!intoId.trim()) return
    if (!window.confirm(`Merge "${fromName}" into ${intoId.trim()}? Every edge will be repointed. This cannot be undone from the admin.`)) return
    start(async () => {
      const res = await mergeEntity(fromId, intoId.trim())
      if (!res.ok) { setError(res.error); return }
      router.push(`/admin/entity/${intoId.trim()}`)
      router.refresh()
    })
  }

  return (
    <details className="card bg-paper border border-rule p-6 mb-6">
      <summary className="text-lg font-bold cursor-pointer">Merge into another entity</summary>
      <form onSubmit={submit} className="mt-4 flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1">
          <Input label="Surviving entity id (uuid)" value={intoId} onChange={e => setIntoId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" className="font-mono text-sm" />
        </div>
        <Button type="submit" variant="secondary" loading={pending} disabled={!intoId.trim()}>Merge</Button>
      </form>
      {error && <p className="mt-2 text-sm" role="alert">⚠ {error}</p>}
    </details>
  )
}
