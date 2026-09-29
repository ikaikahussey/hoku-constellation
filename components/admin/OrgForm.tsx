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

const ORG_TYPES = [
  'government_agency', 'nonprofit', 'corporation', 'pac', 'lobbying_firm',
  'law_firm', 'labor_union', 'trade_association', 'educational_institution',
  'media_outlet', 'religious_org', 'cultural_org', 'land_trust', 'developer',
  'utility', 'other',
]
const SECTORS = ['energy', 'real_estate', 'healthcare', 'tourism', 'agriculture', 'construction', 'finance', 'tech', 'military', 'education', 'other']
const ISLANDS = ['Oahu', 'Maui', 'Hawaii', 'Kauai', 'Molokai', 'Lanai', 'Niihau', 'Statewide']
const STATUSES = ['active', 'dissolved', 'merged', 'acquired']

const opts = (xs: string[]) => xs.map(x => ({ value: x, label: x.replace(/_/g, ' ') }))
function s(v: unknown): string { return typeof v === 'string' ? v : '' }

export function OrgForm({ org }: { org?: EntityRow }) {
  const router = useRouter()
  const a = org?.attributes ?? {}
  const ids = org?.identifiers ?? {}
  const [pending, start] = useTransition()
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: org?.name ?? '',
    slug: s(a.slug),
    aliases: (org?.aliases ?? []).join(', '),
    org_type: s(a.org_type),
    sector: s(a.sector),
    island: s(a.island),
    description: s(a.description),
    website_url: s(a.website_url),
    status: s(a.status) || 'active',
    is_featured: a.is_featured === true,
    is_priority: a.is_priority === true,
    visibility: s(a.visibility) || 'gated',
    ein: s(ids.ein),
    dcca: s(ids.dcca),
    sec_cik: s(ids.sec_cik),
    fec_id: s(ids.fec_id),
  })

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm(prev => {
      const next = { ...prev, [k]: v }
      if (k === 'name' && !org) next.slug = slugify(String(v))
      return next
    })
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const fd = new FormData()
    for (const [k, v] of Object.entries(form)) {
      if (k === 'is_featured' || k === 'is_priority') { if (v) fd.set(k, 'on'); continue }
      fd.set(k, String(v))
    }
    start(async () => {
      const res = org ? await updateEntity(org.id, fd) : await createEntity('org', fd)
      if (!res.ok) { setError(res.error); return }
      router.push(`/admin/entity/${res.id}`)
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-6">
      {error && <p className="border border-ink p-3 text-sm" role="alert">⚠ {error}</p>}

      <section className="card bg-paper border border-rule p-6 space-y-4">
        <h2 className="text-lg font-bold">Basic information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2"><Input label="Name *" required value={form.name} onChange={e => set('name', e.target.value)} /></div>
          <Input label="URL slug" value={form.slug} onChange={e => set('slug', e.target.value)} className="font-mono text-sm" />
          <Input label="Aliases (comma-separated)" value={form.aliases} onChange={e => set('aliases', e.target.value)} />
          <Select label="Organization type *" required value={form.org_type} onChange={e => set('org_type', e.target.value)} options={opts(ORG_TYPES)} placeholder="Select…" />
          <Select label="Sector" value={form.sector} onChange={e => set('sector', e.target.value)} options={opts(SECTORS)} placeholder="Select…" />
          <Select label="Island" value={form.island} onChange={e => set('island', e.target.value)} options={opts(ISLANDS)} placeholder="Select…" />
          <Input label="Website" value={form.website_url} onChange={e => set('website_url', e.target.value)} />
        </div>
      </section>

      <section className="card bg-paper border border-rule p-6 space-y-4">
        <h2 className="text-lg font-bold">Identifiers</h2>
        <p className="text-sm text-muted">Structured ids let ingestion match records exactly before falling back to fuzzy name matching.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="EIN" value={form.ein} onChange={e => set('ein', e.target.value)} placeholder="99-0123456" className="font-mono text-sm" />
          <Input label="DCCA file number" value={form.dcca} onChange={e => set('dcca', e.target.value)} className="font-mono text-sm" />
          <Input label="SEC CIK" value={form.sec_cik} onChange={e => set('sec_cik', e.target.value)} className="font-mono text-sm" />
          <Input label="FEC committee id" value={form.fec_id} onChange={e => set('fec_id', e.target.value)} className="font-mono text-sm" />
        </div>
      </section>

      <section className="card bg-paper border border-rule p-6 space-y-4">
        <h2 className="text-lg font-bold">Description</h2>
        <Textarea label="Description (Markdown)" rows={6} value={form.description} onChange={e => set('description', e.target.value)} className="font-mono text-sm" placeholder="Markdown description…" />
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
        <Button type="submit" loading={pending}>{org ? 'Update organization' : 'Create organization'}</Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  )
}
