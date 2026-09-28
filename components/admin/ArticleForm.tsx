'use client'

import { useActionState, useState } from 'react'
import { createArticleForm } from '@/app/admin/actions'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'

const SOURCES = [
  { value: 'hoku_fm', label: 'Hoku.FM' },
  { value: 'hawaii_independent', label: 'Hawaii Independent' },
  { value: 'external', label: 'External' },
]

/** Adds an article as a document (doc_type='article') with optional mentioned_in edges. */
export function ArticleForm() {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(createArticleForm, null)

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between gap-4 mb-4">
        <h1 className="text-2xl font-bold">Articles</h1>
        <Button variant={open ? 'secondary' : 'primary'} onClick={() => setOpen(o => !o)}>{open ? 'Cancel' : '+ Add article'}</Button>
      </div>

      {state && state.ok && (
        <p className="border border-rule p-3 text-sm mb-4">
          {state.created ? 'Article added.' : 'An article with that URL already exists; any entity links were attached to it.'}
        </p>
      )}
      {state && !state.ok && <p className="border border-ink p-3 text-sm mb-4" role="alert">⚠ {state.error}</p>}

      {open && (
        <form action={action} className="card bg-paper border border-rule p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2"><Input label="Title *" name="title" required /></div>
            <div className="md:col-span-2"><Input label="URL *" name="url" type="url" required placeholder="https://" /></div>
            <Select label="Source" name="source" options={SOURCES} defaultValue="hoku_fm" />
            <Input label="Published date" name="doc_date" type="date" />
            <Input label="Author" name="author" />
            <Input label="Tags (comma-separated)" name="tags" />
            <div className="md:col-span-2"><Textarea label="Summary" name="summary" rows={3} /></div>
            <div className="md:col-span-2">
              <Input label="Mentioned entity ids (comma-separated uuids)" name="entity_ids" className="font-mono text-sm" placeholder="Creates mentioned_in edges from each entity to this article" />
            </div>
          </div>
          <Button type="submit" loading={pending}>Add article</Button>
        </form>
      )}
    </div>
  )
}
