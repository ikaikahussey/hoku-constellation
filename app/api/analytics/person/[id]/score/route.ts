import { NextResponse } from 'next/server'
import { authenticateSubscriber } from '../../../_lib/auth'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, supabase } = await authenticateSubscriber()
  if (error) return error
  const { id } = await params
  const { data, error: dbErr } = await supabase
    .from('ax_influence_score')
    .select('*')
    .eq('person_id', id)
    .maybeSingle()
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })
  return NextResponse.json(data ?? null)
}
