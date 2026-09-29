/** POST /api/ask — Ask HOKU Insider (E5). Logs only question length and result count to PostHog. */
import { NextResponse, type NextRequest } from 'next/server'
import { getWorkspace } from '@/lib/workspace'
import { ask, AskError } from '@/lib/ask'
import { EVENTS } from '@/lib/analytics-events'
import { captureServerEvent } from '@/lib/analytics-server'

export const maxDuration = 120

export async function POST(request: NextRequest) {
  const ws = await getWorkspace()
  if (!ws) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as { question?: string; from?: string; to?: string; source?: string; entityId?: string }
  try {
    const r = await ask(ws.db, {
      userId: ws.user.id, teamId: ws.team.id, question: String(body.question ?? ''), entitlements: ws.user.isStaff ? ws.user.entitlements : ws.features,
      filters: { from: body.from, to: body.to, source: body.source, entityId: body.entityId },
    })
    await captureServerEvent(ws.user.id, EVENTS.QUESTION_ASKED, { question_length: String(body.question ?? '').trim().length, result_count: r.resultCount, answered: !r.insufficient })
    return NextResponse.json(r)
  } catch (e) {
    const status = e instanceof AskError ? e.status : 500
    return NextResponse.json({ error: e instanceof AskError ? e.message : 'The question could not be answered right now.' }, { status })
  }
}
