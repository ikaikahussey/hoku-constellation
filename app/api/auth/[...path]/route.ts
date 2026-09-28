import type { NextRequest } from 'next/server'
import { getAuth } from '@/lib/auth'

// Proxies Better Auth requests (sign-in, sign-up, sign-out, OAuth callbacks, password reset, session)
// to the Neon Auth server and manages the session cookies. The handler is created lazily so a build
// without NEON_AUTH_* env vars (CI, preview without secrets) still completes.
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ path: string[] }> }
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

function route(method: Method) {
  return (request: NextRequest, ctx: Ctx) => {
    const h = getAuth().handler() as unknown as Record<Method, (req: NextRequest, ctx: Ctx) => Promise<Response>>
    return h[method](request, ctx)
  }
}

export const GET = route('GET')
export const POST = route('POST')
export const PUT = route('PUT')
export const DELETE = route('DELETE')
export const PATCH = route('PATCH')
