import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiRequest, paginationParams } from '../../../_lib/auth'
import { getDocumentsForEntity } from '@/lib/db/queries'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, db } = await authenticateApiRequest()
  if (error) return error
  const { id } = await params
  const sp = request.nextUrl.searchParams
  const { limit, offset } = paginationParams(sp)
  const data = await getDocumentsForEntity(db, id, { docTypes: sp.get('doc_types')?.split(',').filter(Boolean), limit, offset })
  return NextResponse.json({ data, limit, offset })
}
