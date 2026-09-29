/**
 * Design-partner usage (E9): per team, over a window (default the last 7 days).
 */
import type { Db } from '@/lib/db/types'
import { renderEmail } from '@/lib/email/template'
import { getEmailTransport, type EmailTransport } from '@/lib/email/resend'
import { SITE_URL } from '@/lib/site'

export interface PartnerUsage {
  team_id: string; name: string; plan: string; is_design_partner: boolean
  seats_active: number; seat_count: number; active_days_per_seat: number
  alerts_delivered: number; alerts_opened: number; reports_generated: number; reports_sent: number
  briefings_viewed: number; questions: number; last_login: string | null
}

export async function partnerUsage(db: Db, opts: { days?: number; partnersOnly?: boolean } = {}): Promise<PartnerUsage[]> {
  const days = opts.days ?? 7
  return db.many<PartnerUsage>(
    `with w as (select now() - make_interval(days => $1) since)
     select t.id team_id, t.name, t.plan, t.is_design_partner, t.seat_count,
            (select count(*)::int from app.team_member m where m.team_id = t.id and m.joined_at is not null and m.removed_at is null) seats_active,
            coalesce(round((select count(distinct (u.user_id, (u.created_at at time zone 'Pacific/Honolulu')::date))::numeric from app.usage_event u, w where u.team_id = t.id and u.created_at > w.since)
              / nullif((select count(*) from app.team_member m where m.team_id = t.id and m.joined_at is not null and m.removed_at is null), 0), 1), 0)::float8 active_days_per_seat,
            (select count(*)::int from app.alert_delivery d, w where d.team_id = t.id and d.status in ('sent','digested','collapsed') and d.sent_at > w.since) alerts_delivered,
            (select count(*)::int from app.alert_delivery d, w where d.team_id = t.id and d.opened_at > w.since) alerts_opened,
            (select count(*)::int from app.report r, w where r.team_id = t.id and r.created_at > w.since) reports_generated,
            (select count(*)::int from app.report r, w where r.team_id = t.id and r.sent_at > w.since) reports_sent,
            (select count(*)::int from app.usage_event u, w where u.team_id = t.id and u.kind = 'briefing.viewed' and u.created_at > w.since) briefings_viewed,
            (select count(*)::int from app.ask_log a, w where a.team_id = t.id and a.created_at > w.since) questions,
            (select max(u.created_at)::text from app.usage_event u where u.team_id = t.id and u.kind = 'session.active') last_login
       from app.team t
      where not t.is_personal and ($2::boolean is false or t.is_design_partner)
      order by t.is_design_partner desc, t.name`, [days, opts.partnersOnly ?? false])
}

/** Weekly usage summary for the owner (Mondays, from /api/cron/ops and the alerts worker). */
export async function sendWeeklyPartnerSummary(db: Db, opts: { transport?: EmailTransport } = {}): Promise<boolean> {
  const owner = process.env.OWNER_EMAIL
  if (!owner) return false
  const rows = await partnerUsage(db, { days: 7, partnersOnly: true })
  const { html, text } = renderEmail({
    title: `Design partners: week ending ${new Date().toISOString().slice(0, 10)}`,
    intro: rows.length ? `${rows.length} design-partner team${rows.length === 1 ? '' : 's'}.` : 'No design-partner teams yet.',
    blocks: rows.map(r => ({
      heading: r.name,
      lines: [
        { text: `${r.seats_active} of ${r.seat_count} seats active · ${r.active_days_per_seat} active days per seat` },
        { text: `${r.alerts_delivered} alerts delivered, ${r.alerts_opened} opened` },
        { text: `${r.reports_generated} reports generated, ${r.reports_sent} sent · ${r.briefings_viewed} briefings viewed · ${r.questions} questions` },
        { text: `Last login ${r.last_login?.slice(0, 16) ?? 'never'}` },
      ],
    })),
    footer: [{ text: 'Partner dashboard', href: `${SITE_URL}/admin/partners` }],
  })
  const [r] = await (opts.transport ?? getEmailTransport()).send([{ to: [owner], subject: '[HOKU Insider] Weekly design-partner usage', html, text, tags: { kind: 'partner_summary' } }])
  return r.ok
}
