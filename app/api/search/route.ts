import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const q = searchParams.get('q') || ''
  const type = searchParams.get('type') || ''
  const island = searchParams.get('island') || ''
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50)
  const offset = parseInt(searchParams.get('offset') || '0')

  if (!q) {
    return NextResponse.json({ results: [], total: 0 })
  }

  const supabase = await createClient()
  const results: Record<string, unknown>[] = []

  if (!type || type === 'person') {
    let query = supabase
      .from('person')
      .select('id, full_name, slug, office_held, entity_types, island, status, party')
      .ilike('full_name', `%${q}%`)
      .order('is_featured', { ascending: false })
      .limit(limit)

    if (island) query = query.eq('island', island)

    const { data } = await query
    if (data) {
      for (const p of data) {
        results.push({
          id: p.id,
          type: 'person',
          name: p.full_name,
          slug: p.slug,
          subtitle: [p.office_held, p.party].filter(Boolean).join(' · '),
          badges: p.entity_types,
          island: p.island,
          status: p.status,
        })
      }
    }
  }

  if (!type || type === 'organization') {
    let query = supabase
      .from('organization')
      .select('id, name, slug, org_type, island, sector, status')
      .ilike('name', `%${q}%`)
      .order('is_featured', { ascending: false })
      .limit(limit)

    if (island) query = query.eq('island', island)

    const { data } = await query
    if (data) {
      for (const o of data) {
        results.push({
          id: o.id,
          type: 'organization',
          name: o.name,
          slug: o.slug,
          subtitle: [o.org_type?.replace(/_/g, ' '), o.sector?.replace(/_/g, ' ')].filter(Boolean).join(' · '),
          badges: [o.org_type].filter(Boolean),
          island: o.island,
          status: o.status,
        })
      }
    }
  }

  return NextResponse.json({ results: results.slice(offset, offset + limit), total: results.length })
}
