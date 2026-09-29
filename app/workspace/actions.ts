'use server'

/**
 * Workspace write path (E2, E3, E6, E7, E9). Every action resolves the workspace from the session,
 * checks membership/role/feature, and writes through the service connection. Pages read directly.
 */
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { requireWorkspace, TEAM_COOKIE, type Workspace } from '@/lib/workspace'
import {
  createTeam as createTeamRow, inviteMember, removeMember, renameTeam, revokeInvitation, setMemberRole, transferOwnership, TeamError,
} from '@/lib/teams'
import { createAlertRule, muteRule, type AlertChannel } from '@/lib/alerts/rules'
import { isSlackWebhookUrl } from '@/lib/alerts/channels'
import { encryptSecret } from '@/lib/crypto'
import { approveReport, generateReportDraft, sendReport, updateReportDraft, type RichBlock } from '@/lib/reports'
import { rotateCalendarToken } from '@/lib/export/calendar'
import { renderEmail } from '@/lib/email/template'
import { sendEmail } from '@/lib/email/resend'
import { SITE_URL } from '@/lib/site'
import { EVENTS } from '@/lib/analytics-events'
import { captureServerEvent } from '@/lib/analytics-server'
import { getStripe } from '@/lib/stripe/client'
import { cancelAtPeriodEnd, changePlan, changeSeats, createCheckout, createInvoiceSubscription, createPortalSession } from '@/lib/billing'
import type { Interval, PaidPlan } from '@/lib/billing/plans'

export type ActionState = { ok: boolean; message?: string; error?: string; data?: Record<string, unknown> } | null

const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === 'string' ? v.trim() : '' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function run(fn: (ws: Workspace) => Promise<string | void | ActionState>, paths: string[] = ['/workspace']): Promise<ActionState> {
  const ws = await requireWorkspace()
  try {
    const r = await fn(ws)
    for (const p of paths) revalidatePath(p)
    if (r && typeof r === 'object') return r
    return { ok: true, message: typeof r === 'string' ? r : undefined }
  } catch (e) {
    const err = e as Error & { status?: number }
    if (err.message === 'NEXT_REDIRECT' || (err as { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) throw e
    return { ok: false, error: err instanceof TeamError || err.status ? err.message : `Something went wrong: ${err.message}` }
  }
}

async function ownsWatchlist(ws: Workspace, id: string) {
  const r = await ws.db.one(`select 1 from app.watchlist where id = $1 and team_id = $2`, [id, ws.team.id])
  if (!r) throw new TeamError('Watchlist not found', 404)
}
async function ownsClient(ws: Workspace, id: string) {
  const r = await ws.db.one(`select 1 from app.client where id = $1 and team_id = $2`, [id, ws.team.id])
  if (!r) throw new TeamError('Client not found', 404)
}
function requireAdmin(ws: Workspace) { if (!ws.isAdmin) throw new TeamError('Only the owner or an admin can do this', 403) }
function requireFeature(ws: Workspace, f: 'reports' | 'alerts' | 'exports') {
  if (!ws.features[f]) throw new TeamError(`${f === 'reports' ? 'Client reports are' : f === 'alerts' ? 'Alerts are' : 'Exports are'} not included in the ${ws.features.tier} plan`, 403)
}

// ------------------------------------------------------------------------------------------------ teams

export async function switchTeam(fd: FormData) {
  const ws = await requireWorkspace()
  const id = str(fd, 'team_id')
  if (ws.teams.some(t => t.id === id)) (await cookies()).set(TEAM_COOKIE, id, { httpOnly: true, sameSite: 'lax', path: '/' })
  redirect('/workspace')
}

export async function createTeamAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async ws => {
    const team = await createTeamRow(ws.db, ws.user.id, str(fd, 'name'), { email: ws.user.email })
    ;(await cookies()).set(TEAM_COOKIE, team.id, { httpOnly: true, sameSite: 'lax', path: '/' })
    await captureServerEvent(ws.user.id, EVENTS.TEAM_CREATED, { plan: team.plan })
    return `Created ${team.name}`
  }, ['/workspace', '/workspace/team'])
}

export async function renameTeamAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async ws => {
    await renameTeam(ws.db, ws.user.id, ws.team.id, str(fd, 'name'))
    const sender = str(fd, 'sender_name')
    if (sender) await ws.db.query(`update app.team set sender_name = $2 where id = $1`, [ws.team.id, sender.slice(0, 80)])
    return 'Saved'
  }, ['/workspace/team'])
}

export async function inviteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async ws => {
    const role = str(fd, 'role') === 'admin' ? 'admin' : 'member'
    const inv = await inviteMember(ws.db, ws.user.id, ws.team.id, str(fd, 'email'), role)
    const link = `${SITE_URL}/invite/${inv.token}`
    const { html, text } = renderEmail({
      title: `Join ${ws.team.name} on HOKU Insider`,
      intro: `${ws.user.name ?? ws.user.email} invited you to the ${ws.team.name} workspace. The invitation expires in 14 days.`,
      blocks: [{ lines: [{ text: 'Accept the invitation', href: link }] }],
      footer: [{ text: 'HOKU Insider', href: SITE_URL }],
    })
    const sent = await sendEmail({ to: [inv.email], subject: `Invitation to ${ws.team.name} on HOKU Insider`, html, text, tags: { kind: 'invitation' } })
    await captureServerEvent(ws.user.id, EVENTS.MEMBER_INVITED, { role })
    return { ok: true, message: sent.ok ? `Invitation sent to ${inv.email}` : `Invitation created; email failed (${sent.error}). Share the link directly.`, data: { link } }
  }, ['/workspace/team'])
}

export async function revokeInvitationAction(fd: FormData) {
  await run(ws => revokeInvitation(ws.db, ws.user.id, ws.team.id, str(fd, 'invitation_id')), ['/workspace/team'])
}
export async function setRoleAction(fd: FormData) {
  await run(ws => setMemberRole(ws.db, ws.user.id, ws.team.id, str(fd, 'user_id'), str(fd, 'role') === 'admin' ? 'admin' : 'member'), ['/workspace/team'])
}
export async function removeMemberAction(fd: FormData) {
  await run(ws => removeMember(ws.db, ws.user.id, ws.team.id, str(fd, 'user_id')), ['/workspace/team'])
}
export async function transferOwnershipAction(fd: FormData) {
  await run(ws => transferOwnership(ws.db, ws.user.id, ws.team.id, str(fd, 'user_id')), ['/workspace/team'])
}

export async function slackWebhookAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async ws => {
    requireAdmin(ws)
    const url = str(fd, 'webhook_url')
    if (!url) { await ws.db.query(`update app.team set slack_webhook_enc = null where id = $1`, [ws.team.id]); return 'Slack disconnected' }
    if (!isSlackWebhookUrl(url)) throw new TeamError('Use a Slack incoming-webhook URL (https://hooks.slack.com/services/…)')
    await ws.db.query(`update app.team set slack_webhook_enc = $2 where id = $1`, [ws.team.id, encryptSecret(url)])
    return 'Slack connected'
  }, ['/workspace/team', '/workspace'])
}

export async function uploadLogoAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async ws => {
    requireAdmin(ws)
    const file = fd.get('logo')
    if (!(file instanceof File) || !file.size) throw new TeamError('Choose a PNG or JPEG file')
    if (!['image/png', 'image/jpeg'].includes(file.type)) throw new TeamError('Logo must be PNG or JPEG')
    if (file.size > 1_000_000) throw new TeamError('Logo must be under 1 MB')
    const bytes = Buffer.from(await file.arrayBuffer())
    const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    const jpg = bytes[0] === 0xff && bytes[1] === 0xd8
    if (!png && !jpg) throw new TeamError('File is not a PNG or JPEG image')
    const kind = str(fd, 'kind') === 'letterhead' ? 'letterhead' : 'logo'
    const key = `teams/${ws.team.id}/${kind}`
    await ws.db.query(`insert into app.stored_file(key, team_id, content_type, bytes) values ($1, $2, $3, $4)
                       on conflict (key) do update set bytes = excluded.bytes, content_type = excluded.content_type, created_at = now()`,
      [key, ws.team.id, png ? 'image/png' : 'image/jpeg', bytes])
    await ws.db.query(`update app.team set ${kind === 'letterhead' ? 'letterhead_key' : 'logo_key'} = $2 where id = $1`, [ws.team.id, key])
    return `${kind === 'letterhead' ? 'Letterhead' : 'Logo'} uploaded`
  }, ['/workspace/team'])
}

// ------------------------------------------------------------------------------------------------ watchlists and alerts

export async function createWatchlistAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async ws => {
    const name = str(fd, 'name').slice(0, 120)
    if (!name) throw new TeamError('Name the watchlist')
    const client = str(fd, 'client_id')
    if (client) await ownsClient(ws, client)
    await ws.db.query(`insert into app.watchlist(team_id, name, client_id, owner_user_id) values ($1, $2, $3, $4)`, [ws.team.id, name, client || null, ws.user.id])
    return `Created ${name}`
  }, ['/workspace/watchlists', '/workspace'])
}

export async function deleteWatchlistAction(fd: FormData) {
  await run(async ws => { await ownsWatchlist(ws, str(fd, 'watchlist_id')); await ws.db.query(`delete from app.watchlist where id = $1`, [str(fd, 'watchlist_id')]) }, ['/workspace/watchlists'])
}

export async function assignWatchlistAction(fd: FormData) {
  await run(async ws => {
    const wl = str(fd, 'watchlist_id'), client = str(fd, 'client_id')
    await ownsWatchlist(ws, wl)
    if (client) await ownsClient(ws, client)
    await ws.db.query(`update app.watchlist set client_id = $2 where id = $1`, [wl, client || null])
  }, ['/workspace/watchlists', '/workspace/clients'])
}

export async function addWatchItemAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async ws => {
    const wl = str(fd, 'watchlist_id') || (await ws.db.one<{ id: string }>(
      `select id from app.watchlist where team_id = $1 and (owner_user_id = $2 or owner_user_id is null) order by is_default desc, created_at limit 1`, [ws.team.id, ws.user.id]))?.id
    if (!wl) throw new TeamError('Create a watchlist first')
    await ownsWatchlist(ws, wl)
    const type = str(fd, 'type') || 'entity'
    const value = str(fd, 'value')
    const position = ['support', 'oppose', 'monitor'].includes(str(fd, 'position')) ? str(fd, 'position') : null
    const priority = [1, 2, 3].includes(Number(str(fd, 'priority'))) ? Number(str(fd, 'priority')) : null
    let col: string
    let v: string = value
    if (type === 'keyword') { col = 'keyword'; if (value.length < 3) throw new TeamError('Keywords need at least 3 characters'); v = value.slice(0, 120) }
    else if (type === 'source') { col = 'source_key'; if (!/^[a-z0-9_]+$/.test(value)) throw new TeamError('Unknown source') }
    else {
      col = type === 'committee' ? 'committee_entity_id' : 'entity_id'
      if (!UUID.test(value)) throw new TeamError('Pick an item from the search results')
      const e = await ws.db.one(`select 1 from entity where id = $1`, [value])
      if (!e) throw new TeamError('Not found')
    }
    try {
      await ws.db.query(`insert into app.watchlist_item(watchlist_id, ${col}, position, priority) values ($1, $2, $3, $4) on conflict do nothing`, [wl, v, position, priority])
    } catch (e) {
      if (/watch item limit/.test((e as Error).message)) throw new TeamError(`Your plan includes ${ws.features.max_watch_items} watch items. Upgrade to Pro for unlimited watchlists.`, 402)
      throw e
    }
    await captureServerEvent(ws.user.id, EVENTS.WATCHLIST_ITEM_ADDED, { item_type: type })
    return 'Added to watchlist'
  }, ['/workspace/watchlists', '/workspace'])
}

export async function removeWatchItemAction(fd: FormData) {
  await run(async ws => {
    await ws.db.query(`delete from app.watchlist_item i using app.watchlist w where i.id = $1 and w.id = i.watchlist_id and w.team_id = $2`, [str(fd, 'item_id'), ws.team.id])
  }, ['/workspace/watchlists', '/workspace'])
}

export async function createRuleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async ws => {
    requireFeature(ws, 'alerts')
    const wl = str(fd, 'watchlist_id')
    await ownsWatchlist(ws, wl)
    const channel = str(fd, 'channel') as AlertChannel
    if (channel === 'slack' && !ws.team.slack_webhook_enc) throw new TeamError('Connect Slack in Team settings first')
    const eventTypes = fd.getAll('event_types').map(String).filter(Boolean)
    await createAlertRule(ws.db, { watchlistId: wl, userId: ws.user.id, channel, eventTypes, quietStart: str(fd, 'quiet_start') || null, quietEnd: str(fd, 'quiet_end') || null })
    await captureServerEvent(ws.user.id, EVENTS.ALERT_CREATED, { alert_type: channel })
    return 'Alert created'
  }, ['/workspace/watchlists'])
}

async function ownsRule(ws: Workspace, id: string) {
  const r = await ws.db.one(`select 1 from app.alert_rule r join app.watchlist w on w.id = r.watchlist_id where r.id = $1 and w.team_id = $2`, [id, ws.team.id])
  if (!r) throw new TeamError('Alert not found', 404)
}

export async function muteRuleAction(fd: FormData) {
  await run(async ws => {
    const id = str(fd, 'rule_id')
    await ownsRule(ws, id)
    const hours = Number(str(fd, 'hours'))
    await muteRule(ws.db, id, hours > 0 ? new Date(Date.now() + hours * 3600_000) : null)
    if (!hours) await ws.db.query(`update app.alert_rule set unsubscribed_at = null where id = $1`, [id])
  }, ['/workspace/watchlists'])
}

export async function deleteRuleAction(fd: FormData) {
  await run(async ws => { await ownsRule(ws, str(fd, 'rule_id')); await ws.db.query(`delete from app.alert_rule where id = $1`, [str(fd, 'rule_id')]) }, ['/workspace/watchlists'])
}

// ------------------------------------------------------------------------------------------------ clients and reports

export async function saveClientAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async ws => {
    requireFeature(ws, 'reports')
    const id = str(fd, 'client_id')
    const name = str(fd, 'name').slice(0, 160)
    if (!name) throw new TeamError('Client name is required')
    const recipients = str(fd, 'recipients').split(/[\s,;]+/).map(s => s.toLowerCase()).filter(Boolean)
    const bad = recipients.filter(r => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r))
    if (bad.length) throw new TeamError(`Not an email address: ${bad.join(', ')}`)
    const entity = str(fd, 'entity_id')
    const autoDraft = str(fd, 'auto_draft') === 'on'
    if (id) {
      await ownsClient(ws, id)
      await ws.db.query(`update app.client set name = $2, report_recipients = $3, auto_draft = $4, entity_id = coalesce($5, entity_id) where id = $1`,
        [id, name, recipients, autoDraft, UUID.test(entity) ? entity : null])
      return 'Client saved'
    }
    await ws.db.query(`insert into app.client(team_id, name, report_recipients, auto_draft, entity_id) values ($1, $2, $3, $4, $5)`,
      [ws.team.id, name, recipients, autoDraft, UUID.test(entity) ? entity : null])
    return `Added ${name}`
  }, ['/workspace/clients', '/workspace'])
}

export async function deleteClientAction(fd: FormData) {
  await run(async ws => { await ownsClient(ws, str(fd, 'client_id')); await ws.db.query(`delete from app.client where id = $1`, [str(fd, 'client_id')]) }, ['/workspace/clients'])
}

export async function generateReportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ws = await requireWorkspace()
  let id: string
  try {
    requireFeature(ws, 'reports')
    const client = str(fd, 'client_id')
    await ownsClient(ws, client)
    const r = await generateReportDraft(ws.db, { teamId: ws.team.id, clientId: client, start: str(fd, 'start'), end: str(fd, 'end'), userId: ws.user.id })
    await captureServerEvent(ws.user.id, EVENTS.REPORT_GENERATED, { narrative_source: r.narrative_source, cited_documents: r.cited_document_ids.length })
    id = r.id
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
  redirect(`/workspace/reports/${id}`)
}

export async function saveReportAction(reportId: string, blocks: RichBlock[], recipients: string[]): Promise<ActionState> {
  return run(async ws => {
    await updateReportDraft(ws.db, { teamId: ws.team.id, reportId, userId: ws.user.id, blocks, recipients })
    return 'Draft saved'
  }, [`/workspace/reports/${reportId}`, '/workspace/reports'])
}

export async function approveReportAction(fd: FormData) {
  const id = str(fd, 'report_id')
  await run(async ws => {
    await approveReport(ws.db, { teamId: ws.team.id, reportId: id, userId: ws.user.id })
    await captureServerEvent(ws.user.id, EVENTS.REPORT_APPROVED, {})
  }, [`/workspace/reports/${id}`, '/workspace/reports'])
}

export async function sendReportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, 'report_id')
  return run(async ws => {
    const r = await sendReport(ws.db, { teamId: ws.team.id, reportId: id, userId: ws.user.id })
    await captureServerEvent(ws.user.id, EVENTS.REPORT_SENT, { recipients: r.recipients.length })
    return `Sent to ${r.recipients.length} recipient${r.recipients.length === 1 ? '' : 's'}`
  }, [`/workspace/reports/${id}`, '/workspace/reports'])
}

export async function deleteReportAction(fd: FormData) {
  await run(async ws => { await ws.db.query(`delete from app.report where id = $1 and team_id = $2 and status = 'draft'`, [str(fd, 'report_id'), ws.team.id]) }, ['/workspace/reports'])
  redirect('/workspace/reports')
}

// ------------------------------------------------------------------------------------------------ notes, calendar, onboarding, feedback

export async function addNoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async ws => {
    const body = str(fd, 'body').slice(0, 10_000)
    const entity = str(fd, 'entity_id'), doc = str(fd, 'document_id')
    if (!body) throw new TeamError('Write a note first')
    await ws.db.query(`insert into app.note(team_id, author_user_id, entity_id, document_id, body) values ($1, $2, $3, $4, $5)`,
      [ws.team.id, ws.user.id, UUID.test(entity) ? entity : null, UUID.test(doc) && !UUID.test(entity) ? doc : null, body])
    return 'Note saved'
  }, [str(fd, 'path') || '/workspace'])
}

export async function rotateCalendarAction(): Promise<ActionState> {
  return run(async ws => {
    const token = await rotateCalendarToken(ws.db, ws.user.id)
    await captureServerEvent(ws.user.id, EVENTS.CALENDAR_SUBSCRIBED, {})
    return { ok: true, message: 'New calendar link created. The previous link no longer works.', data: { url: `${SITE_URL}/api/calendar/${token}.ics` } }
  }, ['/workspace/settings'])
}

export async function dismissOnboardingAction() {
  await run(async ws => {
    await ws.db.query(`insert into app.user_pref(user_id, onboarding_dismissed) values ($1, true) on conflict (user_id) do update set onboarding_dismissed = true`, [ws.user.id])
  })
}

export async function feedbackAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async ws => {
    const body = str(fd, 'feedback').slice(0, 5000)
    if (body.length < 3) throw new TeamError('Tell us a little more')
    const page = str(fd, 'page').slice(0, 300)
    await captureServerEvent(ws.user.id, EVENTS.FEEDBACK_SUBMITTED, { length: body.length, is_design_partner: ws.team.is_design_partner })
    const owner = process.env.OWNER_EMAIL
    if (owner) {
      const { html, text } = renderEmail({
        title: `Feedback from ${ws.team.name}${ws.team.is_design_partner ? ' (design partner)' : ''}`,
        blocks: [{ lines: [{ text: body }, { text: `From ${ws.user.email} · ${ws.features.tier} · page ${page || 'unknown'}` }] }],
        footer: [{ text: 'HOKU Insider', href: SITE_URL }],
      })
      await sendEmail({ to: [owner], subject: `[HOKU Insider feedback] ${ws.team.name}`, html, text, replyTo: ws.user.email, tags: { kind: 'feedback' } })
    }
    return 'Thanks — the team reads every note.'
  })
}

// ------------------------------------------------------------------------------------------------ billing

export async function checkoutAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ws = await requireWorkspace()
  let url: string
  try {
    const r = await createCheckout(getStripe(), ws.db, {
      teamId: ws.team.id, userId: ws.user.id, email: ws.user.email, plan: str(fd, 'plan') as PaidPlan,
      interval: (str(fd, 'interval') || 'year') as Interval, seats: Number(str(fd, 'seats') || 1), coupon: str(fd, 'coupon') || null,
    })
    await captureServerEvent(ws.user.id, EVENTS.CHECKOUT_STARTED, { tier: str(fd, 'plan'), interval: str(fd, 'interval') === 'month' ? 'monthly' : 'yearly' })
    url = r.url
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
  redirect(url)
}

export async function invoiceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async ws => {
    await createInvoiceSubscription(getStripe(), ws.db, {
      teamId: ws.team.id, userId: ws.user.id, email: str(fd, 'billing_email') || ws.user.email, plan: str(fd, 'plan') as PaidPlan,
      interval: (str(fd, 'interval') || 'year') as Interval, seats: Number(str(fd, 'seats') || 1), coupon: str(fd, 'coupon') || null, poNumber: str(fd, 'po_number') || null,
    })
    return 'Subscription created. The first invoice will be emailed with net-30 terms.'
  }, ['/workspace/billing', '/workspace'])
}

export async function seatsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async ws => { await changeSeats(getStripe(), ws.db, { teamId: ws.team.id, userId: ws.user.id, seats: Number(str(fd, 'seats')) }); return 'Seats updated; the change is prorated.' }, ['/workspace/billing', '/workspace/team'])
}

export async function planAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async ws => { await changePlan(getStripe(), ws.db, { teamId: ws.team.id, userId: ws.user.id, plan: str(fd, 'plan') as PaidPlan, interval: (str(fd, 'interval') || 'year') as Interval }); return 'Plan changed.' }, ['/workspace/billing', '/workspace'])
}

export async function cancelAction(): Promise<ActionState> {
  return run(async ws => { await cancelAtPeriodEnd(getStripe(), ws.db, { teamId: ws.team.id, userId: ws.user.id }); return 'Your plan will end at the close of the current billing period.' }, ['/workspace/billing'])
}

export async function portalAction() {
  const ws = await requireWorkspace()
  const url = await createPortalSession(getStripe(), ws.db, { teamId: ws.team.id, userId: ws.user.id })
  redirect(url)
}
