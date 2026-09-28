import { NextRequest, NextResponse } from 'next/server'

// OAuth and magic-link flows complete on the Neon Auth server, which sets the session cookie via
// /api/auth/[...path] and redirects here with ?next=. This route only forwards to the destination.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const next = searchParams.get('next') ?? '/search'
  const error = searchParams.get('error')
  if (error) return NextResponse.redirect(`${origin}/auth/login?error=${encodeURIComponent(error)}`)
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/search'
  return NextResponse.redirect(`${origin}${safeNext}`)
}
