/**
 * Delivery channels. Email goes through lib/email/resend.ts. Slack uses the team's incoming webhook
 * (stored encrypted in app.team.slack_webhook_enc). SMS is out of scope for this build: the
 * interface exists so a provider can be added without touching the pipeline.
 */
import { getEmailTransport, type EmailTransport } from '@/lib/email/resend'
import { decryptSecret } from '@/lib/crypto'

export interface SlackMessage { webhookEnc: string; text: string; blocks?: unknown[] }
export interface SlackSender { send(m: SlackMessage): Promise<{ ok: boolean; error?: string }> }
export interface SmsMessage { to: string; body: string }
export interface SmsSender { readonly enabled: boolean; send(m: SmsMessage): Promise<{ ok: boolean; error?: string }> }

export interface Channels { email: EmailTransport; slack: SlackSender; sms: SmsSender }

/** Only Slack's incoming-webhook host is accepted, so a stored URL cannot be used to reach other hosts. */
export function isSlackWebhookUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname === 'hooks.slack.com' && u.pathname.startsWith('/services/')
  } catch { return false }
}

export class WebhookSlackSender implements SlackSender {
  constructor(private fetchImpl: typeof fetch = fetch) {}
  async send(m: SlackMessage) {
    let url: string
    try { url = decryptSecret(m.webhookEnc) } catch (e) { return { ok: false, error: `webhook decrypt failed: ${(e as Error).message}` } }
    if (!isSlackWebhookUrl(url)) return { ok: false, error: 'stored webhook is not a Slack incoming-webhook URL' }
    const res = await this.fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: m.text, blocks: m.blocks }) })
    return res.ok ? { ok: true } : { ok: false, error: `Slack ${res.status}` }
  }
}

export class DisabledSmsSender implements SmsSender {
  readonly enabled = false
  async send() { return { ok: false, error: 'SMS delivery is not enabled' } }
}

export function defaultChannels(): Channels {
  return { email: getEmailTransport(), slack: new WebhookSlackSender(), sms: new DisabledSmsSender() }
}
