import { NextResponse, type NextRequest } from 'next/server'
import { authenticateSubscriber } from '../../../_lib/auth'
import { getBillLandscape } from '@/lib/analytics'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ billNumber: string }> }
) {
  const { error, supabase } = await authenticateSubscriber()
  if (error) return error
  const { billNumber } = await params
  const session = request.nextUrl.searchParams.get('session') ?? String(new Date().getFullYear())
  try {
    return NextResponse.json(await getBillLandscape(supabase, billNumber, session))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
