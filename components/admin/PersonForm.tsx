'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { slugify } from '@/lib/slugify'

const ENTITY_TYPES = [
  'elected_official', 'appointed_official', 'lobbyist', 'donor', 'contractor',
  'nonprofit_leader', 'business_leader', 'labor_leader', 'university_admin',
  'media_figure', 'cultural_practitioner', 'legal_professional', 'other',
]

const ISLANDS = ['Oahu', 'Maui', 'Hawaii', 'Kauai', 'Molokai', 'Lanai', 'Niihau', 'Statewide']
const PARTIES = ['Democrat', 'Republican', 'Green', 'Libertarian', 'Nonpartisan', 'Independent']
const STATUSES = ['active', 'inactive', 'deceased', 'former']
const VISIBILITIES = ['public', 'gated']

interface PersonFormProps {
  person?: Record<string, unknown>
}

export function PersonForm({ person }: PersonFormProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [formData, setFormData] = useState({
    full_name: (person?.full_name as string) || '',
    first_name: (person?.first_name as string) || '',
    last_name: (person?.last_name as string) || '',
    slug: (person?.slug as string) || '',
    aliases: ((person?.aliases as string[]) || []).join(', '),
    entity_types: (person?.entity_types as string[]) || [],
    office_held: (person?.office_held as string) || '',
    party: (person?.party as string) || '',
    district: (person?.district as string) || '',
    island: (person?.island as string) || '',
    term_start: (person?.term_start as string) || '',
    term_end: (person?.term_end as string) || '',
    bio_summary: (person?.bio_summary as string) || '',
    photo_url: (person?.photo_url as string) || '',
    website_url: (person?.website_url as string) || '',
    status: (person?.status as string) || 'active',
    is_featured: (person?.is_featured as boolean) || false,
    visibility: (person?.visibility as string) || 'gated',
  })

  function updateField(field: string, value: unknown) {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (field === 'full_name' && !person) {
      setFormData((prev) => ({ ...prev, slug: slugify(value as string) }))
    }
  }

  function toggleEntityType(type: string) {
    setFormData((prev) => ({
      ...prev,
      entity_types: prev.entity_types.includes(type)
        ? prev.entity_types.filter((t) => t !== type)
        : [...prev.entity_types, type],
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const supabase = createClient()
    const payload = {
      ...formData,
      aliases: formData.aliases
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean),
      term_start: formData.term_start || null,
      term_end: formData.term_end || null,
    }

    if (person) {
      const { error: err } = await supabase
        .from('person')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', person.id)
      if (err) {
        setError(err.message)
        setSaving(false)
        return
      }
    } else {
      const { error: err } = await supabase.from('person').insert(payload)
      if (err) {
        setError(err.message)
        setSaving(false)
        return
      }
    }

    router.push('/admin/person')
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
            <label className="block text-sm font-medium text-white/70 mb-1">Full Name *</label>
            <input
              required
              value={formData.full_name}
              onChange={(e) => updateField('full_name', e.target.value)}
              className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white placeholder-white/40 focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">First Name</label>
            <input
              value={formData.first_name}
              onChange={(e) => updateField('first_name', e.target.value)}
              className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Last Name</label>
            <input
              value={formData.last_name}
              onChange={(e) => updateField('last_name', e.target.value)}
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
              placeholder="e.g., Josh, J. Green"
              className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white placeholder-white/40 focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
            />
          </div>
        </div>
      </div>

      <div className="bg-navy-light rounded-lg border border-white/10 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">Entity Types</h2>
        <div className="flex flex-wrap gap-2">
          {ENTITY_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => toggleEntityType(type)}
              className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                formData.entity_types.includes(type)
                  ? 'bg-gold/20 text-gold border border-gold/40'
                  : 'bg-white/5 text-white/50 border border-white/10 hover:border-white/30'
              }`}
            >
              {type.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-navy-light rounded-lg border border-white/10 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">Office & Political Info</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-white/70 mb-1">Office Held</label>
            <input
              value={formData.office_held}
              onChange={(e) => updateField('office_held', e.target.value)}
              placeholder="e.g., Governor, State Senator"
              className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white placeholder-white/40 focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Party</label>
            <select
              value={formData.party}
              onChange={(e) => updateField('party', e.target.value)}
              className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
            >
              <option value="">Select...</option>
              {PARTIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">District</label>
            <input
              value={formData.district}
              onChange={(e) => updateField('district', e.target.value)}
              className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
            />
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
            <label className="block text-sm font-medium text-white/70 mb-1">Term Start</label>
            <input
              type="date"
              value={formData.term_start}
              onChange={(e) => updateField('term_start', e.target.value)}
              className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Term End</label>
            <input
              type="date"
              value={formData.term_end}
              onChange={(e) => updateField('term_end', e.target.value)}
              className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
            />
          </div>
        </div>
      </div>

      <div className="bg-navy-light rounded-lg border border-white/10 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">Bio & Links</h2>
        <div>
          <label className="block text-sm font-medium text-white/70 mb-1">Bio Summary (Markdown)</label>
          <textarea
            value={formData.bio_summary}
            onChange={(e) => updateField('bio_summary', e.target.value)}
            rows={8}
            className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white placeholder-white/40 font-mono text-sm focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
            placeholder="Write a biographical summary in Markdown..."
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Photo URL</label>
            <input
              value={formData.photo_url}
              onChange={(e) => updateField('photo_url', e.target.value)}
              className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Website URL</label>
            <input
              value={formData.website_url}
              onChange={(e) => updateField('website_url', e.target.value)}
              className="block w-full rounded-md border border-white/20 bg-navy px-3 py-2 text-white focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
            />
          </div>
        </div>
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
              {VISIBILITIES.map((v) => <option key={v} value={v}>{v}</option>)}
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
          {saving ? 'Saving...' : person ? 'Update Person' : 'Create Person'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="text-sm text-white/50 hover:text-white transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
