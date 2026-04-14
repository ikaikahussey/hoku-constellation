import { NextResponse } from 'next/server'
import { authenticateSubscriber } from '../../../_lib/auth'
import { findShortestPath } from '@/lib/analytics'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ idA: string; idB: string }> }
) {
  const { error, supabase } = await authenticateSubscriber()
  if (error) return error
  const { idA, idB } = await params
  const result = await findShortestPath(supabase, idA, idB, 3)
  return NextResponse.json(result ?? { path: null })
}
