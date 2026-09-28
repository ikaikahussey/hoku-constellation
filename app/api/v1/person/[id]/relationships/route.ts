import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiRequest, edgeToApi } from '../../../_lib/auth'
import { getEdges } from '@/lib/db/queries'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, db } = await authenticateApiRequest()
  if (error) return error
  const { id } = await params
  const rows = await getEdges(db, id, { types: ['employed_by', 'officer_of', 'director_of', 'member_of', 'appointed_to', 'confirmed_by', 'lobbied_for'], direction: 'both', limit: 500 })
  return NextResponse.json({ data: rows.map(e => edgeToApi(e as unknown as Record<string, unknown>)) })
}
