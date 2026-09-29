import { NextResponse, type NextRequest } from 'next/server'
import { getAuth, TEST_SESSION_COOKIE, testAuthEnabled } from '@/lib/auth'

// Next.js 16 `proxy` (formerly middleware). Refreshes the Neon Auth session cookie and requires a
// session for /account, /workspace, and /admin. Staff authorization for /admin is enforced in
// app/admin/layout.tsx against user_account.is_staff, because the proxy cannot query Postgres.
const PROTECTED = ['/account', '/admin', '/workspace']

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isProtected = PROTECTED.some(p => pathname === p || pathname.startsWith(`${p}/`))
  if (!isProtected) return NextResponse.next()
  // Offline e2e sessions are verified by getCurrentUser(); the proxy only lets them through.
  if (testAuthEnabled() && request.cookies.get(TEST_SESSION_COOKIE)) return NextResponse.next()
  const loginUrl = `/auth/login?next=${encodeURIComponent(pathname)}`
  return getAuth().middleware({ loginUrl })(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|ingest|api/).*)'],
}
