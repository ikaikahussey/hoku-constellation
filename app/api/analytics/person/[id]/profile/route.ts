import { NextResponse } from 'next/server'
import { authenticateSubscriber } from '../../../_lib/auth'
import { getPersonProfile } from '@/lib/analytics'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, supabase } = await authenticateSubscriber()
  if (error) return error
  const { id } = await params
  try {
    const profile = await getPersonProfile(supabase, id)
    return NextResponse.json(profile)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
