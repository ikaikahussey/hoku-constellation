/**
 * GET /api/calendar/<secret>.ics — per-user feed of hearings and testimony deadlines for watched
 * bills (E7). The secret is the only credential; rotating it in settings invalidates this URL.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { getServiceDb } from '@/lib/db/service'
import { userCalendar, userForCalendarToken } from '@/lib/export/calendar'

export async function GET(_: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token.replace(/\.ics$/, '')
  const db = await getServiceDb()
  const userId = await userForCalendarToken(db, token)
  if (!userId) return new NextResponse('Not found', { status: 404 })
  return new NextResponse(await userCalendar(db, userId), {
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': 'inline; filename="hoku-insider.ics"', 'cache-control': 'private, max-age=300' },
  })
}
