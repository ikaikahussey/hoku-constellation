/**
 * Email delivery through Resend (https://resend.com/docs/api-reference). RESEND_API_KEY is required
 * in production; without it (or with EMAIL_TRANSPORT=log) messages are written to the log and
 * reported as sent so local runs and tests never reach a real inbox.
 */
export interface EmailMessage {
  to: string[]
  subject: string
  html: string
  text: string
  /** Display name for the From header; the address is EMAIL_FROM_ADDRESS. */
  fromName?: string
  replyTo?: string
  headers?: Record<string, string>
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>
  tags?: Record<string, string>
}

export interface EmailResult { ok: boolean; id: string | null; error?: string }

export interface EmailTransport {
  send(messages: EmailMessage[]): Promise<EmailResult[]>
}

const API = 'https://api.resend.com'
export const FROM_ADDRESS = () => (process.env.EMAIL_FROM_ADDRESS ?? 'alerts@hoku.fm').trim()

function fromHeader(name?: string) {
  const clean = (name ?? 'HOKU Insider').replace(/[<>"\r\n]/g, '').slice(0, 80)
  return `${clean} <${FROM_ADDRESS()}>`
}

function toResend(m: EmailMessage) {
  return {
    from: fromHeader(m.fromName), to: m.to, subject: m.subject, html: m.html, text: m.text,
    reply_to: m.replyTo, headers: m.headers,
    attachments: m.attachments?.map(a => ({ filename: a.filename, content: a.content.toString('base64'), content_type: a.contentType })),
    tags: m.tags ? Object.entries(m.tags).map(([name, value]) => ({ name, value: value.replace(/[^A-Za-z0-9_-]/g, '_') })) : undefined,
  }
}

export class ResendTransport implements EmailTransport {
  constructor(private apiKey: string, private fetchImpl: typeof fetch = fetch) {}

  async send(messages: EmailMessage[]): Promise<EmailResult[]> {
    const out: EmailResult[] = []
    // Batch endpoint: up to 100 messages, no attachments. Messages with attachments go one by one.
    const plain = messages.map((m, i) => ({ m, i })).filter(x => !x.m.attachments?.length)
    const withFiles = messages.map((m, i) => ({ m, i })).filter(x => x.m.attachments?.length)
    const results = new Array<EmailResult>(messages.length)
    for (let s = 0; s < plain.length; s += 100) {
      const chunk = plain.slice(s, s + 100)
      const res = await this.post('/emails/batch', chunk.map(x => toResend(x.m)))
      const ids = (res.body as { data?: Array<{ id: string }> } | null)?.data ?? []
      chunk.forEach((x, j) => { results[x.i] = res.ok ? { ok: true, id: ids[j]?.id ?? null } : { ok: false, id: null, error: res.error } })
    }
    for (const x of withFiles) {
      const res = await this.post('/emails', toResend(x.m))
      results[x.i] = res.ok ? { ok: true, id: (res.body as { id?: string } | null)?.id ?? null } : { ok: false, id: null, error: res.error }
    }
    out.push(...results)
    return out
  }

  private async post(path: string, body: unknown): Promise<{ ok: boolean; body: unknown; error?: string }> {
    const res = await this.fetchImpl(`${API}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) return { ok: false, body: json, error: `Resend ${res.status}: ${(json as { message?: string } | null)?.message ?? res.statusText}` }
    return { ok: true, body: json }
  }
}

/** Collects messages in memory (tests, `EMAIL_TRANSPORT=memory`). */
export class MemoryTransport implements EmailTransport {
  sent: Array<EmailMessage & { at: number }> = []
  async send(messages: EmailMessage[]): Promise<EmailResult[]> {
    return messages.map(m => { this.sent.push({ ...m, at: Date.now() }); return { ok: true, id: `mem_${this.sent.length}` } })
  }
}

class LogTransport implements EmailTransport {
  async send(messages: EmailMessage[]): Promise<EmailResult[]> {
    for (const m of messages) console.log(`[email:log] to=${m.to.length} recipient(s) subject=${JSON.stringify(m.subject)}`)
    return messages.map(() => ({ ok: true, id: null }))
  }
}

let override: EmailTransport | null = null
export function setEmailTransportForTests(t: EmailTransport | null) { override = t }

export function getEmailTransport(): EmailTransport {
  if (override) return override
  const key = process.env.RESEND_API_KEY
  if (!key || process.env.EMAIL_TRANSPORT === 'log') return new LogTransport()
  return new ResendTransport(key)
}

export async function sendEmail(m: EmailMessage): Promise<EmailResult> {
  return (await getEmailTransport().send([m]))[0]
}
