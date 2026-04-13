import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authenticateApiRequest, paginationParams } from '../_lib/auth'

export async function GET(request: NextRequest) {
  const { error } = await authenticateApiRequest()
  if (error) return error

  const { searchParams } = request.nextUrl
  const { limit, offset } = paginationParams(searchParams)
  const status = searchParams.get('status')
  const utilityType = searchParams.get('utility_type')

  const supabase = await createClient()
  let query = supabase
    .from('puc_docket')
    .select('*')
    .order('filed_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)
  if (utilityType) query = query.eq('utility_type', utilityType)

  const { data } = await query
  return NextResponse.json({ data: data || [], limit, offset })
}
