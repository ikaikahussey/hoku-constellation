import { NextResponse } from 'next/server'
import { authenticateSubscriber } from '../../../_lib/auth'
import { getOrgProfile } from '@/lib/analytics'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, db } = await authenticateSubscriber()
  if (error) return error
  const { id } = await params
  try {
    return NextResponse.json(await getOrgProfile(db, id))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
