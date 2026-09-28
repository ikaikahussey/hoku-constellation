import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiRequest } from '../../../_lib/auth'
import { getArticlesForEntity } from '@/lib/db/queries'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, db } = await authenticateApiRequest()
  if (error) return error
  const { id } = await params
  return NextResponse.json({ data: await getArticlesForEntity(db, id, 100) })
}
