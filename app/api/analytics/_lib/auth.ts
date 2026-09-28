import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getServiceDb } from '@/lib/db/service'
import type { Db } from '@/lib/db/types'

/**
 * Subscriber-gate analytics routes: paid tier in active/trialing status, or staff.
 * Returns the service Db for the handler; the gate itself is the access control (mirrors RLS).
 */
export async function authenticateSubscriber(): Promise<{ error: NextResponse | null; db: Db; userId: string | null }> {
  const db = await getServiceDb()
  const user = await getCurrentUser()
  if (!user) return { error: NextResponse.json({ error: 'Authentication required' }, { status: 401 }), db, userId: null }
  if (!user.canAccessGated) return { error: NextResponse.json({ error: 'Subscription required' }, { status: 403 }), db, userId: user.id }
  return { error: null, db, userId: user.id }
}

/** Bearer CRON_SECRET auth for admin/cron routes. */
export function authenticateCron(request: Request): Response | null {
  const header = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || header !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

/** Staff-only gate for admin UI API routes (session-based). */
export async function authenticateStaff(): Promise<{ error: NextResponse | null; db: Db; userId: string | null }> {
  const db = await getServiceDb()
  const user = await getCurrentUser()
  if (!user) return { error: NextResponse.json({ error: 'Authentication required' }, { status: 401 }), db, userId: null }
  if (!user.isStaff) return { error: NextResponse.json({ error: 'Staff only' }, { status: 403 }), db, userId: user.id }
  return { error: null, db, userId: user.id }
}
