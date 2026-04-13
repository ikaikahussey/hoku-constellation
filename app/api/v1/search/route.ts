import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authenticateApiRequest, paginationParams } from '../_lib/auth'

export async function GET(request: NextRequest) {
  const { error } = await authenticateApiRequest()
  if (error) return error

  const { searchParams } = request.nextUrl
  const q = searchParams.get('q') || ''
  const type = searchParams.get('type') || ''
  const { limit, offset } = paginationParams(searchParams)

  if (!q) return NextResponse.json({ results: [], total: 0, limit, offset })

  const supabase = await createClient()
  const results: Record<string, unknown>[] = []

  if (!type || type === 'person') {
    const { data } = await supabase
      .from('person')
      .select('id, full_name, slug, office_held, entity_types, island, status, party, district')
      .ilike('full_name', `%${q}%`)
      .range(offset, offset + limit - 1)
    if (data) results.push(...data.map(p => ({ ...p, _type: 'person' })))
  }

  if (!type || type === 'org') {
    const { data } = await supabase
      .from('organization')
      .select('id, name, slug, org_type, island, sector, status')
      .ilike('name', `%${q}%`)
      .range(offset, offset + limit - 1)
    if (data) results.push(...data.map(o => ({ ...o, _type: 'organization' })))
  }

  return NextResponse.json({ results, total: results.length, limit, offset })
}
