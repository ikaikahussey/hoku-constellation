import { NextResponse } from 'next/server'
import { authenticateSubscriber } from '../../../_lib/auth'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, db } = await authenticateSubscriber()
  if (error) return error
  const { id } = await params
  try {
    const data = await db.one(`select * from ax_influence_score where entity_id = $1`, [id])
    return NextResponse.json(data ?? null)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
