import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authenticateApiRequest } from '../../../_lib/auth'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await authenticateApiRequest()
  if (error) return error

  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from('timeline_event')
    .select('*')
    .eq('person_id', id)
    .order('event_date', { ascending: false })

  return NextResponse.json({ data: data || [] })
}
