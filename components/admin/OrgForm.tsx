'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { slugify } from '@/lib/slugify'

const ORG_TYPES = [
  'government_agency', 'nonprofit', 'corporation', 'pac', 'lobbying_firm',
  'law_firm', 'labor_union', 'trade_association', 'educational_institution',
  'media_outlet', 'religious_org', 'cultural_org', 'land_trust', 'developer',
  'utility', 'other',
]

const SECTORS = [
  'energy', 'real_estate', 'healthcare', 'tourism', 'agriculture',
  'construction', 'finance', 'tech', 'military', 'education', 'other',
]

const ISLANDS = ['Oahu', 'Maui', 'Hawaii', 'Kauai', 'Molokai', 'Lanai', 'Niihau', 'Statewide']
const STATUSES = ['active', 'dissolved', 'merged', 'acquired']

interface OrgFormProps {
  org?: Record<string, unknown>
}

export function OrgForm({ org }: OrgFormProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [formData, setFormData] = useState({
    name: (org?.name as string) || '',
    slug: (org?.slug as string) || '',
    aliases: ((org?.aliases as string[]) || []).join(', '),
    org_type: (org?.org_type as string) || '',
    description: (org?.description as string) || '',
    website_url: (org?.website_url as string) || '',
    island: (org?.island as string) || '',
    sector: (org?.sector as string) || '',
    status: (org?.status as string) || 'active',
    is_featured: (org?.is_featured as boolean) || false,
    visibility: (org?.visibility as string) || 'gated',
  })

  function updateField(field: string, value: unknown) {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (field === 'name' && !org) {
      setFormData((prev) => ({ ...prev, slug: slugify(value as string) }))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const supabase = createClient()
    const payload = {
      ...formData,
      aliases: formData.aliases.split(',').map((a) => a.trim()).filter(Boolean),
    }

    if (org) {
      const { error: err } = await supabase
        .from('organization')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', org.id)
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      const { error: err } = await supabase.from('organization').insert(payload)
      if (err) { setError(err.message); setSaving(false); return }
    }

    router.push('/admin/org')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">
      {error && (
        <div className="bg-error/10 border border-error/30 rounded-md p-3 text-sm text-red-300">{error}</div>
      )}

      <div className="bg-navy-light rounded-lg border border-white/10 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">Basic Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-white/70 mb-1">Name *</label>
            <input
              required
              value={formData.name}
              onChange={(e) => updateField('name', e.target.value)}
              className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">URL Slug</label>
            <input
              value={formData.slug}
              onChange={(e) => updateField('slug', e.target.value)}
              className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white/60 font-mono text-sm focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Aliases (comma-separated)</label>
            <input
              value={formData.aliases}
              onChange={(e) => updateField('aliases', e.target.value)}
              className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Organization Type *</label>
            <select
              required
              value={formData.org_type}
              onChange={(e) => updateField('org_type', e.target.value)}
              className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
            >
              <option value="">Select...</option>
              {ORG_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Sector</label>
            <select
              value={formData.sector}
              onChange={(e) => updateField('sector', e.target.value)}
              className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
            >
              <option value="">Select...</option>
              {SECTORS.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Island</label>
            <select
              value={formData.island}
              onChange={(e) => updateField('island', e.target.value)}
              className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
            >
              <option value="">Select...</option>
              {ISLANDS.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Website</label>
            <input
              value={formData.website_url}
              onChange={(e) => updateField('website_url', e.target.value)}
              className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
            />
          </div>
        </div>
      </div>

      <div className="bg-navy-light rounded-lg border border-white/10 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">Description</h2>
        <textarea
          value={formData.description}
          onChange={(e) => updateField('description', e.target.value)}
          rows={6}
          className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white font-mono text-sm focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
          placeholder="Markdown description..."
        />
      </div>

      <div className="bg-navy-light rounded-lg border border-white/10 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">Settings</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Status</label>
            <select
              value={formData.status}
              onChange={(e) => updateField('status', e.target.value)}
              className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
            >
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Visibility</label>
            <select
              value={formData.visibility}
              onChange={(e) => updateField('visibility', e.target.value)}
              className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
            >
              <option value="public">public</option>
              <option value="gated">gated</option>
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.is_featured}
                onChange={(e) => updateField('is_featured', e.target.checked)}
                className="rounded border-white/20 bg-navy text-gold focus:ring-gold"
              />
              <span className="text-sm text-white/70">Featured</span>
            </label>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={saving}
          className="bg-gold text-navy px-6 py-2.5 rounded-md font-semibold text-sm hover:bg-gold-light transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : org ? 'Update Organization' : 'Create Organization'}
        </button>
        <button type="button" onClick={() => router.back()} className="text-sm text-white/50 hover:text-white">
          Cancel
        </button>
      </div>
    </form>
  )
}
