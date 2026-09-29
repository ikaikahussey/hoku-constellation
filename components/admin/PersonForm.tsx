'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createEntity, updateEntity } from '@/app/admin/actions'
import { slugify } from '@/lib/slugify'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import type { EntityRow } from '@/lib/db/types'

const ENTITY_TYPES = [
  'elected_official', 'appointed_official', 'lobbyist', 'donor', 'contractor',
  'nonprofit_leader', 'business_leader', 'labor_leader', 'university_admin',
  'media_figure', 'cultural_practitioner', 'legal_professional', 'other',
]
const ISLANDS = ['Oahu', 'Maui', 'Hawaii', 'Kauai', 'Molokai', 'Lanai', 'Niihau', 'Statewide']
const PARTIES = ['Democrat', 'Republican', 'Green', 'Libertarian', 'Nonpartisan', 'Independent']
const STATUSES = ['active', 'inactive', 'deceased', 'former']

const opts = (xs: string[]) => xs.map(x => ({ value: x, label: x.replace(/_/g, ' ') }))

interface PersonFormProps { person?: EntityRow }

function s(v: unknown): string { return typeof v === 'string' ? v : '' }

export function PersonForm({ person }: PersonFormProps) {
  const router = useRouter()
  const a = person?.attributes ?? {}
  const [pending, start] = useTransition()
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: person?.name ?? '',
    first_name: s(a.first_name),
    last_name: s(a.last_name),
    slug: s(a.slug),
    aliases: (person?.aliases ?? []).join(', '),
    entity_types: Array.isArray(a.entity_types) ? (a.entity_types as string[]) : [],
    office_held: s(a.office_held),
    party: s(a.party),
    district: s(a.district),
    island: s(a.island),
    term_start: s(a.term_start),
    term_end: s(a.term_end),
    bio_summary: s(a.bio_summary),
    photo_url: s(a.photo_url),
    website_url: s(a.website_url),
    status: s(a.status) || 'active',
    is_featured: a.is_featured === true,
    is_priority: a.is_priority === true,
    visibility: s(a.visibility) || 'gated',
  })

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm(prev => {
      const next = { ...prev, [k]: v }
      if (k === 'name' && !person) next.slug = slugify(String(v))
      return next
    })
  }

  function toggleType(t: string) {
    set('entity_types', form.entity_types.includes(t) ? form.entity_types.filter(x => x !== t) : [...form.entity_types, t])
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const fd = new FormData()
    for (const [k, v] of Object.entries(form)) {
      if (k === 'entity_types') { for (const t of v as string[]) fd.append('entity_types', t); continue }
      if (k === 'is_featured' || k === 'is_priority') { if (v) fd.set(k, 'on'); continue }
      fd.set(k, String(v))
    }
    start(async () => {
      const res = person ? await updateEntity(person.id, fd) : await createEntity('person', fd)
      if (!res.ok) { setError(res.error); return }
      router.push(`/admin/person/${res.id}`)
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-6">
      {error && <p className="border border-ink p-3 text-sm" role="alert">⚠ {error}</p>}

      <section className="card bg-paper border border-rule p-6 space-y-4">
        <h2 className="text-lg font-bold">Basic information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2"><Input label="Full name *" required value={form.name} onChange={e => set('name', e.target.value)} /></div>
          <Input label="First name" value={form.first_name} onChange={e => set('first_name', e.target.value)} />
          <Input label="Last name" value={form.last_name} onChange={e => set('last_name', e.target.value)} />
          <Input label="URL slug" value={form.slug} onChange={e => set('slug', e.target.value)} className="font-mono text-sm" />
          <Input label="Aliases (comma-separated)" value={form.aliases} onChange={e => set('aliases', e.target.value)} placeholder="e.g., Josh, J. Green" />
        </div>
      </section>

      <section className="card bg-paper border border-rule p-6 space-y-4">
        <h2 className="text-lg font-bold">Entity types</h2>
        <div className="flex flex-wrap gap-2">
          {ENTITY_TYPES.map(t => {
            const on = form.entity_types.includes(t)
            return (
              <button key={t} type="button" onClick={() => toggleType(t)} aria-pressed={on}
                className={`btn px-3 py-1.5 text-sm border ${on ? 'bg-ink text-paper border-ink font-bold' : 'bg-paper text-ink border-rule hover:border-ink'}`}>
                {t.replace(/_/g, ' ')}
              </button>
            )
          })}
        </div>
      </section>

      <section className="card bg-paper border border-rule p-6 space-y-4">
        <h2 className="text-lg font-bold">Office and political information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2"><Input label="Office held" value={form.office_held} onChange={e => set('office_held', e.target.value)} placeholder="e.g., Governor, State Senator" /></div>
          <Select label="Party" value={form.party} onChange={e => set('party', e.target.value)} options={opts(PARTIES)} placeholder="Select…" />
          <Input label="District" value={form.district} onChange={e => set('district', e.target.value)} />
          <Select label="Island" value={form.island} onChange={e => set('island', e.target.value)} options={opts(ISLANDS)} placeholder="Select…" />
          <div />
          <Input label="Term start" type="date" value={form.term_start} onChange={e => set('term_start', e.target.value)} />
          <Input label="Term end" type="date" value={form.term_end} onChange={e => set('term_end', e.target.value)} />
        </div>
      </section>

      <section className="card bg-paper border border-rule p-6 space-y-4">
        <h2 className="text-lg font-bold">Bio and links</h2>
        <Textarea label="Bio summary (Markdown)" rows={8} value={form.bio_summary} onChange={e => set('bio_summary', e.target.value)} className="font-mono text-sm" placeholder="Write a biographical summary in Markdown…" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="Photo URL" value={form.photo_url} onChange={e => set('photo_url', e.target.value)} />
          <Input label="Website URL" value={form.website_url} onChange={e => set('website_url', e.target.value)} />
        </div>
      </section>

      <section className="card bg-paper border border-rule p-6 space-y-4">
        <h2 className="text-lg font-bold">Settings</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Select label="Status" value={form.status} onChange={e => set('status', e.target.value)} options={opts(STATUSES)} />
          <Select label="Visibility" value={form.visibility} onChange={e => set('visibility', e.target.value)} options={opts(['public', 'gated'])} />
          <div className="flex items-end gap-6">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input type="checkbox" checked={form.is_featured} onChange={e => set('is_featured', e.target.checked)} className="h-4 w-4 border border-ink accent-ink" />
              Featured
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm" title="Collect this entity's records first and sort its names first in match review">
              <input type="checkbox" checked={form.is_priority} onChange={e => set('is_priority', e.target.checked)} className="h-4 w-4 border border-ink accent-ink" />
              Priority
            </label>
          </div>
        </div>
      </section>

      <div className="flex items-center gap-4">
        <Button type="submit" loading={pending}>{person ? 'Update person' : 'Create person'}</Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  )
}
