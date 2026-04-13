import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authenticateApiRequest } from '../../_lib/auth'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await authenticateApiRequest()
  if (error) return error

  const { id } = await params
  const supabase = await createClient()
  const { data, error: dbError } = await supabase.from('person').select('*').eq('id', id).single()

  if (dbError || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}
