import { getAuth } from '@/lib/auth'

// Proxies Better Auth requests (sign-in, sign-up, sign-out, OAuth callbacks, password reset, session)
// to the Neon Auth server and manages the session cookies.
const handler = getAuth().handler()

export const GET = handler.GET
export const POST = handler.POST
export const PUT = handler.PUT
export const DELETE = handler.DELETE
export const PATCH = handler.PATCH
