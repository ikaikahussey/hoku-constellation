/**
 * Offline end-to-end sign-in (Playwright only). Returns 404 unless test auth is enabled — see
 * testAuthEnabled() in lib/auth.ts, which is never true on Vercel or a non-localhost site URL.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { TEST_SESSION_COOKIE, signTestSession, testAuthEnabled } from '@/lib/auth'

export async function POST(request: NextRequest) {
  if (!testAuthEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id, email, name } = await request.json() as { id?: string; email?: string; name?: string }
  if (!id || !email) return NextResponse.json({ error: 'id and email required' }, { status: 400 })
  const res = NextResponse.json({ ok: true })
  res.cookies.set(TEST_SESSION_COOKIE, await signTestSession({ id, email, name }), { httpOnly: true, sameSite: 'lax', path: '/' })
  return res
}
