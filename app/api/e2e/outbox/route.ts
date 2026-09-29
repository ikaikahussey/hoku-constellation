/** Offline e2e only: emails captured by EMAIL_TRANSPORT=memory. 404 unless test auth is enabled. */
import { NextResponse } from 'next/server'
import { testAuthEnabled } from '@/lib/auth'
import { memoryOutbox } from '@/lib/email/resend'

export async function GET() {
  if (!testAuthEnabled() || process.env.EMAIL_TRANSPORT !== 'memory') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(memoryOutbox().sent.map(m => ({ to: m.to, subject: m.subject, text: m.text, attachments: m.attachments?.map(a => a.filename) ?? [] })))
}
