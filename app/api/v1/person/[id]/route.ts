import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiRequest } from '../../_lib/auth'
import { getEntity } from '@/lib/db/queries'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, db } = await authenticateApiRequest()
  if (error) return error
  const { id } = await params
  const entity = await getEntity(db, id)
  if (!entity || entity.kind !== 'person') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ...entity, full_name: entity.name, ...entity.attributes })
}
