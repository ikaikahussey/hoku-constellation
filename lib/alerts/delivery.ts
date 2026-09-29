/**
 * Alert delivery (E2 step 2). Sends due instant deliveries (email, Slack) and assembles digests.
 *
 *   - Lease: due rows are claimed by pushing scheduled_for forward, so two workers never send the
 *     same row and a crashed worker's rows come back after the lease.
 *   - Burst collapse: when one recipient has 10+ events on the same entity within 10 minutes, the
 *     pending ones go out as a single alert; the rest are marked `collapsed` into it.
 *   - Retries: failed sends retry with backoff (1, 2, 4 min) and are marked `failed` after 3 attempts.
 */
import type { Db } from '@/lib/db/types'
import { renderEmail } from '@/lib/email/template'
import type { EmailMessage } from '@/lib/email/resend'
import { EVENT_LABELS, type AlertEventType } from './events'
import type { Channels } from './channels'
import { documentHref, entityHref, openPixelUrl, unsubscribeUrl } from './links'
import { SITE_URL } from '@/lib/site'

export const BURST_THRESHOLD = 10
export const BURST_WINDOW_MS = 10 * 60_000
const LEASE_MS = 2 * 60_000
const MAX_ATTEMPTS = 3

interface DueRow {
  id: string; alert_event_id: string; team_id: string; rule_id: string | null; user_id: string | null; channel: string; dedup_key: string; attempts: number
  event_type: AlertEventType; headline: string; detail: Record<string, unknown>; entity_id: string | null; document_id: string | null
  detected_at: string; fetched_at: string | null
  entity_kind: string | null; entity_slug: string | null; entity_name: string | null
  email: string | null; team_name: string; slack_webhook_enc: string | null; watchlist_name: string | null
}

export interface DeliveryResult { claimed: number; sent: number; collapsed: number; failed: number; retried: number; messages: number }

const DUE_SELECT = `
  select d.id, d.alert_event_id, d.team_id, d.rule_id, d.user_id, d.channel, d.dedup_key, d.attempts,
         ev.event_type, ev.headline, ev.detail, ev.entity_id, ev.document_id, ev.detected_at::text detected_at, ev.fetched_at::text fetched_at,
         en.kind entity_kind, en.attributes->>'slug' entity_slug, en.name entity_name,
         (select m.email from app.team_member m where m.team_id = d.team_id and m.user_id = d.user_id) email,
         t.name team_name, t.slack_webhook_enc, w.name watchlist_name
    from app.alert_delivery d
    join app.alert_event ev on ev.id = d.alert_event_id
    join app.team t on t.id = d.team_id
    left join app.watchlist w on w.id = ev.watchlist_id
    left join entity en on en.id = ev.entity_id`

/** Claim and send every due instant delivery, in chunks of `chunk` rows (at most `maxChunks` per call). */
export async function runDelivery(db: Db, channels: Channels, opts: { now?: Date; chunk?: number; maxChunks?: number } = {}): Promise<DeliveryResult> {
  const total: DeliveryResult = { claimed: 0, sent: 0, collapsed: 0, failed: 0, retried: 0, messages: 0 }
  const chunk = opts.chunk ?? 2000
  for (let i = 0; i < (opts.maxChunks ?? 50); i++) {
    const r = await deliverChunk(db, channels, opts.now ?? new Date(), chunk)
    for (const k of Object.keys(total) as Array<keyof DeliveryResult>) total[k] += r[k]
    if (r.claimed < chunk) break
  }
  return total
}

async function deliverChunk(db: Db, channels: Channels, now: Date, limit: number): Promise<DeliveryResult> {
  const res: DeliveryResult = { claimed: 0, sent: 0, collapsed: 0, failed: 0, retried: 0, messages: 0 }
  const claimed = await db.many<{ id: string }>(
    `update app.alert_delivery set scheduled_for = $2::timestamptz + interval '${LEASE_MS / 1000} seconds', attempts = attempts + 1, status = 'pending'
      where id in (select id from app.alert_delivery where status in ('pending','deferred') and channel in ('email','slack')
                     and scheduled_for <= $2 order by scheduled_for limit $1 for update skip locked)
      returning id`, [limit, now.toISOString()])
  res.claimed = claimed.length
  if (!claimed.length) return res
  const rows = await db.many<DueRow>(`${DUE_SELECT} where d.id = any($1::uuid[]) order by ev.detected_at`, [claimed.map(c => c.id)])

  // Recent sends per (recipient, entity) inside the burst window.
  const recent = await db.many<{ rkey: string; n: number }>(
    `select coalesce(d.user_id, 'team:' || d.team_id || ':' || d.channel) || '|' || ev.entity_id rkey, count(*)::int n
       from app.alert_delivery d join app.alert_event ev on ev.id = d.alert_event_id
      where d.status in ('sent','collapsed') and d.sent_at > $1::timestamptz - interval '${BURST_WINDOW_MS / 1000} seconds'
        and ev.entity_id is not null and d.channel in ('email','slack')
      group by 1`, [now.toISOString()])
  const recentBy = new Map(recent.map(r => [r.rkey, r.n]))

  // Group by recipient + entity for burst collapse.
  const groups = new Map<string, DueRow[]>()
  for (const r of rows) {
    const recipient = r.user_id ?? `team:${r.team_id}:${r.channel}`
    const k = r.entity_id ? `${recipient}|${r.entity_id}` : `${recipient}|single:${r.id}`
    const g = groups.get(k)
    if (g) g.push(r)
    else groups.set(k, [r])
  }

  const outbound: Array<{ primary: DueRow; members: DueRow[] }> = []
  for (const [k, g] of groups) {
    const windowCount = g.length + (recentBy.get(k) ?? 0)
    if (g.length >= 2 && windowCount >= BURST_THRESHOLD) outbound.push({ primary: g[0], members: g })
    else for (const r of g) outbound.push({ primary: r, members: [r] })
  }

  const emails: Array<{ msg: EmailMessage; item: (typeof outbound)[number] }> = []
  const slack: Array<(typeof outbound)[number]> = []
  const unsendable: DueRow[] = []
  for (const item of outbound) {
    const p = item.primary
    if (p.channel === 'email') {
      if (!p.email) { unsendable.push(...item.members); continue }
      emails.push({ msg: alertEmail(item.primary, item.members), item })
    } else if (p.channel === 'slack') {
      if (!p.slack_webhook_enc) { unsendable.push(...item.members); continue }
      slack.push(item)
    }
  }

  const sentIds: string[] = [], collapsed: Array<{ id: string; into: string }> = []
  const failures: Array<{ row: DueRow; error: string }> = []
  const record = (item: (typeof outbound)[number], ok: boolean, error?: string) => {
    if (ok) {
      sentIds.push(item.primary.id)
      for (const m of item.members) if (m.id !== item.primary.id) collapsed.push({ id: m.id, into: item.primary.id })
    } else for (const m of item.members) failures.push({ row: m, error: error ?? 'send failed' })
  }

  if (emails.length) {
    const results = await channels.email.send(emails.map(e => e.msg))
    results.forEach((r, i) => record(emails[i].item, r.ok, r.error))
    res.messages += emails.length
  }
  for (const item of slack) {
    const r = await channels.slack.send({ webhookEnc: item.primary.slack_webhook_enc!, text: slackText(item.primary, item.members) })
    record(item, r.ok, r.error)
    res.messages++
  }
  for (const r of unsendable) failures.push({ row: r, error: r.channel === 'email' ? 'no email address on file for recipient' : 'team has no Slack webhook' })

  if (sentIds.length) {
    await db.query(`update app.alert_delivery set status = 'sent', sent_at = now(), error = null where id = any($1::uuid[])`, [sentIds])
  }
  if (collapsed.length) {
    await db.query(
      `update app.alert_delivery d set status = 'collapsed', sent_at = now(), collapsed_into = x.into_id
         from jsonb_to_recordset($1::jsonb) as x(id uuid, into_id uuid) where d.id = x.id`,
      [JSON.stringify(collapsed.map(c => ({ id: c.id, into_id: c.into })))])
  }
  for (const f of failures) {
    if (f.row.attempts >= MAX_ATTEMPTS || f.error.startsWith('no email') || f.error.startsWith('team has no')) {
      await db.query(`update app.alert_delivery set status = 'failed', error = $2 where id = $1`, [f.row.id, f.error.slice(0, 500)])
      res.failed++
    } else {
      const backoffMin = 2 ** (f.row.attempts - 1)
      await db.query(`update app.alert_delivery set status = 'pending', error = $2, scheduled_for = $3 where id = $1`,
        [f.row.id, f.error.slice(0, 500), new Date(now.getTime() + backoffMin * 60_000).toISOString()])
      res.retried++
    }
  }
  res.sent = sentIds.length
  res.collapsed = collapsed.length
  return res
}

function eventLine(r: DueRow) {
  return {
    text: r.headline,
    href: entityHref(r.entity_id ? { id: r.entity_id, kind: r.entity_kind, slug: r.entity_slug } : null, r.document_id),
    meta: [EVENT_LABELS[r.event_type] ?? r.event_type, r.watchlist_name ? `Watchlist: ${r.watchlist_name}` : null].filter(Boolean).join(' · '),
  }
}

function footer(r: DueRow) {
  return [
    ...(r.document_id ? [{ text: 'Source document', href: documentHref(r.document_id) }] : []),
    { text: 'Manage alerts', href: `${SITE_URL}/account/alerts` },
    ...(r.rule_id ? [{ text: 'Unsubscribe from this alert', href: unsubscribeUrl(r.rule_id) }] : []),
  ]
}

export function alertEmail(primary: DueRow, members: DueRow[]): EmailMessage {
  const collapsedBurst = members.length > 1
  const title = collapsedBurst ? `${members.length} updates on ${primary.entity_name ?? 'a watched item'}` : primary.headline
  const { html, text } = renderEmail({
    title,
    intro: collapsedBurst ? `${members.length} changes arrived within ten minutes. They are listed below in the order they were detected.` : undefined,
    blocks: [{ lines: members.map(eventLine) }],
    footer: footer(primary),
    pixelUrl: openPixelUrl(primary.id),
  })
  const headers: Record<string, string> = {}
  if (primary.rule_id) {
    headers['List-Unsubscribe'] = `<${unsubscribeUrl(primary.rule_id)}>`
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
  }
  return { to: [primary.email!], subject: `[HOKU Insider] ${title}`.slice(0, 200), html, text, headers, tags: { kind: 'alert', event: primary.event_type } }
}

function slackText(primary: DueRow, members: DueRow[]): string {
  const head = members.length > 1 ? `*${members.length} updates on ${primary.entity_name ?? 'a watched item'}*` : `*${primary.headline}*`
  const lines = members.slice(0, 20).map(m => {
    const l = eventLine(m)
    return `• <${l.href}|${m.headline.replace(/[<>|]/g, '')}> — ${l.meta}`
  })
  return [head, ...lines, members.length > 20 ? `…and ${members.length - 20} more` : ''].filter(Boolean).join('\n')
}

// ------------------------------------------------------------------------------------------------ digests

export interface DigestResult { users: number; events: number; messages: number }

/** Send due daily/weekly digests: one email per user per digest channel. */
export async function runDigests(db: Db, channels: Channels, opts: { now?: Date } = {}): Promise<DigestResult> {
  const now = opts.now ?? new Date()
  const rows = await db.many<DueRow>(
    `${DUE_SELECT} where d.status = 'pending' and d.channel in ('digest_daily','digest_weekly') and d.scheduled_for <= $1
      order by d.user_id, d.channel, ev.detected_at`, [now.toISOString()])
  const byUser = new Map<string, DueRow[]>()
  for (const r of rows) {
    if (!r.user_id) continue
    const k = `${r.user_id}|${r.channel}`
    const g = byUser.get(k)
    if (g) g.push(r)
    else byUser.set(k, [r])
  }
  const msgs: Array<{ msg: EmailMessage | null; ids: string[] }> = []
  for (const g of byUser.values()) {
    const first = g[0]
    const ids = g.map(r => r.id)
    if (!first.email) { msgs.push({ msg: null, ids }); continue }
    const label = first.channel === 'digest_daily' ? 'Daily digest' : 'Weekly digest'
    const byType = new Map<string, DueRow[]>()
    for (const r of g) {
      const t = EVENT_LABELS[r.event_type] ?? r.event_type
      const l = byType.get(t)
      if (l) l.push(r)
      else byType.set(t, [r])
    }
    const { html, text } = renderEmail({
      title: `${label}: ${g.length} update${g.length === 1 ? '' : 's'}`,
      blocks: [...byType].map(([heading, list]) => ({ heading, lines: list.map(eventLine) })),
      footer: [{ text: 'Manage alerts', href: `${SITE_URL}/account/alerts` }, ...(first.rule_id ? [{ text: 'Unsubscribe from this digest', href: unsubscribeUrl(first.rule_id) }] : [])],
      pixelUrl: openPixelUrl(first.id),
    })
    msgs.push({ msg: { to: [first.email], subject: `[HOKU Insider] ${label} — ${g.length} update${g.length === 1 ? '' : 's'}`, html, text, tags: { kind: 'digest' },
      headers: first.rule_id ? { 'List-Unsubscribe': `<${unsubscribeUrl(first.rule_id)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined }, ids })
  }
  const sendable = msgs.filter(m => m.msg)
  const results = sendable.length ? await channels.email.send(sendable.map(m => m.msg!)) : []
  const sent: string[] = [], failed: string[] = []
  sendable.forEach((m, i) => (results[i]?.ok ? sent : failed).push(...m.ids))
  for (const m of msgs) if (!m.msg) failed.push(...m.ids)
  if (sent.length) await db.query(`update app.alert_delivery set status = 'digested', sent_at = now() where id = any($1::uuid[])`, [sent])
  if (failed.length) await db.query(`update app.alert_delivery set attempts = attempts + 1, status = case when attempts >= ${MAX_ATTEMPTS - 1} then 'failed' else 'pending' end, scheduled_for = now() + interval '5 minutes', error = 'digest send failed' where id = any($1::uuid[])`, [failed])
  return { users: byUser.size, events: rows.length, messages: sendable.length }
}
