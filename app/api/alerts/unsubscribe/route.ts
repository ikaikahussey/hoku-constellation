/**
 * One-click unsubscribe for a single alert rule (RFC 8058). Links are HMAC-signed per rule, so no
 * session is needed. GET never changes state (mail scanners prefetch links): it redirects to a
 * confirmation page. POST unsubscribes — from the List-Unsubscribe-Post header or the page's form.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { getServiceDb } from '@/lib/db/service'
import { verify } from '@/lib/crypto'
import { unsubscribeRule } from '@/lib/alerts/rules'

const UUID = /^[0-9a-f-]{36}$/i

export async function GET(request: NextRequest) {
  const url = new URL('/alerts/unsubscribe', request.nextUrl.origin)
  url.search = request.nextUrl.search
  return NextResponse.redirect(url, 303)
}

export async function POST(request: NextRequest) {
  const r = request.nextUrl.searchParams.get('r') ?? ''
  const s = request.nextUrl.searchParams.get('s')
  if (!UUID.test(r) || !verify(`unsub:${r}`, s)) return NextResponse.json({ error: 'Invalid link' }, { status: 400 })
  await unsubscribeRule(await getServiceDb(), r)
  const body = await request.text().catch(() => '')
  if (body.includes('List-Unsubscribe=One-Click')) return new NextResponse(null, { status: 204 })
  const done = new URL('/alerts/unsubscribe', request.nextUrl.origin)
  done.searchParams.set('done', '1')
  return NextResponse.redirect(done, 303)
}
