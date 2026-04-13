import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authenticateApiRequest, paginationParams, csvResponse } from '../_lib/auth'

export async function GET(request: NextRequest) {
  const { error } = await authenticateApiRequest()
  if (error) return error

  const { searchParams } = request.nextUrl
  const { limit, offset } = paginationParams(searchParams)
  const donor = searchParams.get('donor')
  const recipient = searchParams.get('recipient')
  const minAmount = searchParams.get('min_amount')
  const maxAmount = searchParams.get('max_amount')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const format = searchParams.get('format')

  const supabase = await createClient()
  let query = supabase
    .from('contribution')
    .select('*')
    .order('contribution_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (donor) query = query.ilike('donor_name_raw', `%${donor}%`)
  if (recipient) query = query.ilike('recipient_name_raw', `%${recipient}%`)
  if (minAmount) query = query.gte('amount', parseFloat(minAmount))
  if (maxAmount) query = query.lte('amount', parseFloat(maxAmount))
  if (from) query = query.gte('contribution_date', from)
  if (to) query = query.lte('contribution_date', to)

  const { data } = await query

  if (format === 'csv' && data) return csvResponse(data, 'contributions.csv')
  return NextResponse.json({ data: data || [], limit, offset })
}
