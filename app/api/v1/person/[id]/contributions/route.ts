import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authenticateApiRequest, paginationParams, csvResponse } from '../../../_lib/auth'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await authenticateApiRequest()
  if (error) return error

  const { id } = await params
  const { limit, offset } = paginationParams(request.nextUrl.searchParams)
  const format = request.nextUrl.searchParams.get('format')

  const supabase = await createClient()
  const { data } = await supabase
    .from('contribution')
    .select('*')
    .or(`donor_person_id.eq.${id},recipient_person_id.eq.${id}`)
    .order('contribution_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (format === 'csv' && data) return csvResponse(data, `contributions-${id}.csv`)
  return NextResponse.json({ data: data || [], limit, offset })
}
