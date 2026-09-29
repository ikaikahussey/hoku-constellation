/** Open-tracking pixel for alert emails (signed delivery id). Records opened_at once; always returns a 1×1 GIF. */
import { NextResponse, type NextRequest } from 'next/server'
import { getServiceDb } from '@/lib/db/service'
import { verify } from '@/lib/crypto'
import { markDeliveryOpened } from '@/lib/alerts/rules'

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

export async function GET(request: NextRequest) {
  const d = request.nextUrl.searchParams.get('d') ?? ''
  if (/^[0-9a-f-]{36}$/i.test(d) && verify(`open:${d}`, request.nextUrl.searchParams.get('s'))) {
    try { await markDeliveryOpened(await getServiceDb(), d) } catch { /* never fail the pixel */ }
  }
  return new NextResponse(GIF, { headers: { 'content-type': 'image/gif', 'cache-control': 'no-store' } })
}
