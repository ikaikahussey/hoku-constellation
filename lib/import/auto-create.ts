import { SupabaseClient } from '@supabase/supabase-js'
import { slugify } from '@/lib/slugify'

/**
 * Parse a raw name (often "Last, First Middle" format from government data)
 * into structured name parts.
 */
export function parseName(fullNameRaw: string): {
  full_name: string
  first_name: string
  last_name: string
} {
  const fullName = fullNameRaw.trim()
  const commaIdx = fullName.indexOf(',')
  if (commaIdx === -1) {
    const parts = fullName.split(/\s+/)
    return {
      full_name: fullName,
      first_name: parts[0] || '',
      last_name: parts[parts.length - 1] || '',
    }
  }
  const last = fullName.substring(0, commaIdx).trim()
  const firstParts = fullName.substring(commaIdx + 1).trim()
  const firstName = firstParts.split(/\s+/)[0] || ''
  const reconstructed = `${firstName} ${last}`.replace(/\s+/g, ' ').trim()
  return {
    full_name: reconstructed,
    first_name: firstName,
    last_name: last,
  }
}

interface PersonEntry {
  rawName: string
  tag: string // e.g. 'elected_official', 'donor', 'lobbyist'
}

/**
 * Ensure person records exist for a list of raw names.
 * - Creates new persons with entity_types: ['person', ...tags]
 * - Merges new tags into existing persons' entity_types
 * - Returns Map<slug, personId> for all persons (existing + new)
 */
export async function ensurePersons(
  supabase: SupabaseClient,
  entries: PersonEntry[]
): Promise<Map<string, string>> {
  // Parse and deduplicate by slug, collecting tags per slug
  const slugData = new Map<string, {
    full_name: string
    first_name: string
    last_name: string
    tags: Set<string>
  }>()

  for (const entry of entries) {
    if (!entry.rawName || entry.rawName.trim().length === 0) continue
    const parsed = parseName(entry.rawName)
    const slug = slugify(parsed.full_name)
    if (!slug) continue

    const existing = slugData.get(slug)
    if (existing) {
      existing.tags.add(entry.tag)
    } else {
      slugData.set(slug, {
        ...parsed,
        tags: new Set([entry.tag]),
      })
    }
  }

  if (slugData.size === 0) return new Map()

  // Load existing persons in batches (slug IN query has limits)
  const resultMap = new Map<string, string>()
  const allSlugs = Array.from(slugData.keys())
  const existingSlugs = new Set<string>()

  for (let i = 0; i < allSlugs.length; i += 500) {
    const batch = allSlugs.slice(i, i + 500)
    const { data } = await supabase
      .from('person')
      .select('id, slug, entity_types')
      .in('slug', batch)

    for (const person of data || []) {
      resultMap.set(person.slug, person.id)
      existingSlugs.add(person.slug)

      // Merge new tags into existing entity_types
      const info = slugData.get(person.slug)
      if (info) {
        const currentTypes: string[] = person.entity_types || []
        const newTags = Array.from(info.tags).filter(t => !currentTypes.includes(t))
        if (newTags.length > 0) {
          // Ensure 'person' base type exists
          const merged = [...new Set([...currentTypes, 'person', ...newTags])]
          await supabase
            .from('person')
            .update({ entity_types: merged })
            .eq('id', person.id)
        }
      }
    }
  }

  // Create new persons for slugs that don't exist
  const newPersons: {
    full_name: string
    first_name: string
    last_name: string
    slug: string
    entity_types: string[]
    status: string
    visibility: string
  }[] = []

  for (const [slug, info] of slugData) {
    if (existingSlugs.has(slug)) continue
    newPersons.push({
      full_name: info.full_name,
      first_name: info.first_name,
      last_name: info.last_name,
      slug,
      entity_types: ['person', ...Array.from(info.tags)],
      status: 'active',
      visibility: 'public',
    })
  }

  // Batch insert new persons (100 per batch, fallback to individual on error)
  for (let i = 0; i < newPersons.length; i += 100) {
    const batch = newPersons.slice(i, i + 100)
    try {
      const { data, error } = await supabase
        .from('person')
        .insert(batch)
        .select('id, slug')

      if (error) throw error
      for (const p of data || []) {
        resultMap.set(p.slug, p.id)
      }
    } catch {
      // Batch failed — try individual inserts
      for (const person of batch) {
        try {
          const { data, error } = await supabase
            .from('person')
            .insert(person)
            .select('id, slug')
            .single()

          if (!error && data) {
            resultMap.set(data.slug, data.id)
          }
        } catch {
          // Skip — likely a slug collision
        }
      }
    }
  }

  return resultMap
}
