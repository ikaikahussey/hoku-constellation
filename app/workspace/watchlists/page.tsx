import Link from 'next/link'
import { requireWorkspace } from '@/lib/workspace'
import { ALERT_EVENT_TYPES, EVENT_LABELS } from '@/lib/alerts/events'
import { SOURCE_REGISTRY } from '@/lib/import/source-registry'
import { ActionForm } from '@/components/workspace/ActionForm'
import { EntityPicker } from '@/components/workspace/EntityPicker'
import { Badge } from '@/components/ui/Badge'
import { inputClass } from '@/components/ui/Input'
import { addWatchItemAction, assignWatchlistAction, createRuleAction, createWatchlistAction, deleteRuleAction, deleteWatchlistAction, muteRuleAction, removeWatchItemAction } from '../actions'
import { entityHref } from '@/lib/workspace-queries'

export const metadata = { title: 'Watchlists & alerts' }

const CHANNEL_LABEL: Record<string, string> = { email: 'Email (instant)', slack: 'Slack (team channel)', digest_daily: 'Daily digest (7:00 HST)', digest_weekly: 'Weekly digest (Mondays 7:00 HST)', sms: 'SMS' }

export default async function WatchlistsPage() {
  const ws = await requireWorkspace('/workspace/watchlists')
  const [lists, items, rules, clients, count] = await Promise.all([
    ws.db.many<{ id: string; name: string; client_id: string | null; is_default: boolean; owner_user_id: string | null }>(
      `select id, name, client_id, is_default, owner_user_id from app.watchlist where team_id = $1 order by is_default desc, created_at`, [ws.team.id]),
    ws.db.many<{ id: string; watchlist_id: string; entity_id: string | null; keyword: string | null; committee_entity_id: string | null; source_key: string | null; position: string | null; priority: number | null; name: string | null; kind: string | null; slug: string | null }>(
      `select i.*, e.name, e.kind, e.attributes->>'slug' slug from app.watchlist_item i join app.watchlist w on w.id = i.watchlist_id
         left join entity e on e.id = coalesce(i.entity_id, i.committee_entity_id) where w.team_id = $1 order by i.created_at`, [ws.team.id]),
    ws.db.many<{ id: string; watchlist_id: string; user_id: string | null; channel: string; event_types: string[]; quiet_start: string | null; quiet_end: string | null; muted_until: string | null; unsubscribed_at: string | null; active: boolean }>(
      `select r.id, r.watchlist_id, r.user_id, r.channel, r.event_types, to_char(r.quiet_start, 'HH24:MI') quiet_start, to_char(r.quiet_end, 'HH24:MI') quiet_end,
              r.muted_until::text muted_until, r.unsubscribed_at::text unsubscribed_at, r.active
         from app.alert_rule r join app.watchlist w on w.id = r.watchlist_id where w.team_id = $1 order by r.created_at`, [ws.team.id]),
    ws.features.reports ? ws.db.many<{ id: string; name: string }>(`select id, name from app.client where team_id = $1 order by name`, [ws.team.id]) : Promise.resolve([]),
    ws.db.one<{ n: number }>(`select count(*)::int n from app.watchlist_item i join app.watchlist w on w.id = i.watchlist_id where w.team_id = $1`, [ws.team.id]),
  ])
  const limit = ws.features.max_watch_items
  const sources = SOURCE_REGISTRY.filter(s => s.status === 'live')
  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-bold">Watchlists &amp; alerts</h1>
        <p className="text-sm text-muted mt-1">
          {count!.n} watch item{count!.n === 1 ? '' : 's'}{limit != null ? ` of ${limit} on the ${ws.features.tier} plan` : ''}.
          {!ws.features.alerts && <> Alerts need a paid plan. <Link href="/pricing">See plans</Link>.</>}
        </p>
      </header>

      <section aria-labelledby="new-list" className="border border-rule p-5">
        <h2 id="new-list" className="text-lg font-bold mb-3">New watchlist</h2>
        <ActionForm action={createWatchlistAction} submit="Create watchlist" className="grid sm:grid-cols-2 gap-3">
          <div><label htmlFor="wl-name" className="block text-sm font-bold mb-1">Name</label><input id="wl-name" name="name" required className={inputClass} placeholder="Energy bills 2027" /></div>
          {clients.length > 0 && (
            <div><label htmlFor="wl-client" className="block text-sm font-bold mb-1">Client (optional)</label>
              <select id="wl-client" name="client_id" className={inputClass}><option value="">None</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          )}
        </ActionForm>
      </section>

      {lists.map(l => {
        const li = items.filter(i => i.watchlist_id === l.id)
        const lr = rules.filter(r => r.watchlist_id === l.id)
        return (
          <section key={l.id} aria-labelledby={`wl-${l.id}`} className="border border-ink p-5 space-y-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id={`wl-${l.id}`} className="text-xl font-bold">{l.name} {l.is_default && <Badge variant="muted">default</Badge>}</h2>
              <div className="flex items-center gap-3 text-sm">
                {clients.length > 0 && (
                  <form action={assignWatchlistAction} className="flex items-center gap-2">
                    <input type="hidden" name="watchlist_id" value={l.id} />
                    <label htmlFor={`assign-${l.id}`} className="text-muted">Client</label>
                    <select id={`assign-${l.id}`} name="client_id" defaultValue={l.client_id ?? ''} className="border border-rule px-1 py-0.5">
                      <option value="">None</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <button type="submit" className="underline">Assign</button>
                  </form>
                )}
                {!l.is_default && <form action={deleteWatchlistAction}><input type="hidden" name="watchlist_id" value={l.id} /><button type="submit" className="underline">Delete list</button></form>}
              </div>
            </div>

            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide mb-2">Items</h3>
              {li.length ? (
                <ul className="divide-y divide-rule border-y border-rule">
                  {li.map(i => {
                    const href = entityHref(i.kind, i.entity_id ?? i.committee_entity_id, i.slug)
                    const label = i.keyword ? `Keyword: “${i.keyword}”` : i.source_key ? `Source: ${sources.find(s => s.key === i.source_key)?.name ?? i.source_key}` : `${i.committee_entity_id ? 'Committee: ' : ''}${i.name ?? 'Unknown'}`
                    return (
                      <li key={i.id} className="py-2 flex items-center justify-between gap-3">
                        <span>{href ? <Link href={href}>{label}</Link> : label} {i.position && <Badge variant="outline">{i.position}</Badge>} {i.priority && <span className="text-xs text-muted">priority {i.priority}</span>}</span>
                        <form action={removeWatchItemAction}><input type="hidden" name="item_id" value={i.id} /><button type="submit" className="text-sm underline" aria-label={`Remove ${label}`}>Remove</button></form>
                      </li>
                    )
                  })}
                </ul>
              ) : <p className="text-sm text-muted">Nothing on this list yet.</p>}
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              <ActionForm action={addWatchItemAction} submit="Add bill, person, or organization" variant="secondary">
                <input type="hidden" name="watchlist_id" value={l.id} />
                <input type="hidden" name="type" value="entity" />
                <EntityPicker name="value" label="Add a bill, person, or organization" />
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div><label htmlFor={`pos-${l.id}`} className="block text-xs font-bold">Position</label>
                    <select id={`pos-${l.id}`} name="position" className="border border-rule w-full px-1 py-1 text-sm"><option value="">—</option><option value="support">Support</option><option value="oppose">Oppose</option><option value="monitor">Monitor</option></select></div>
                  <div><label htmlFor={`pri-${l.id}`} className="block text-xs font-bold">Priority</label>
                    <select id={`pri-${l.id}`} name="priority" className="border border-rule w-full px-1 py-1 text-sm"><option value="">—</option><option value="1">1 (high)</option><option value="2">2</option><option value="3">3</option></select></div>
                </div>
              </ActionForm>
              <div className="space-y-4">
                <ActionForm action={addWatchItemAction} submit="Add keyword" variant="secondary">
                  <input type="hidden" name="watchlist_id" value={l.id} /><input type="hidden" name="type" value="keyword" />
                  <label htmlFor={`kw-${l.id}`} className="block text-sm font-bold mb-1">Keyword (full text of new documents)</label>
                  <input id={`kw-${l.id}`} name="value" className={inputClass} placeholder="geothermal" />
                </ActionForm>
                <ActionForm action={addWatchItemAction} submit="Add committee" variant="secondary">
                  <input type="hidden" name="watchlist_id" value={l.id} /><input type="hidden" name="type" value="committee" />
                  <EntityPicker name="value" kind="organization" label="Committee (referrals and hearing notices)" placeholder="House Committee on Health" />
                </ActionForm>
                <ActionForm action={addWatchItemAction} submit="Add source" variant="secondary">
                  <input type="hidden" name="watchlist_id" value={l.id} /><input type="hidden" name="type" value="source" />
                  <label htmlFor={`src-${l.id}`} className="block text-sm font-bold mb-1">Every new document from a source</label>
                  <select id={`src-${l.id}`} name="value" className={inputClass}>{sources.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}</select>
                </ActionForm>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide mb-2">Alerts</h3>
              {lr.length > 0 && (
                <ul className="divide-y divide-rule border-y border-rule mb-4">
                  {lr.map(r => {
                    const muted = r.muted_until && new Date(r.muted_until) > new Date()
                    return (
                      <li key={r.id} className="py-2 flex flex-wrap items-center justify-between gap-3 text-sm">
                        <span>
                          <strong>{CHANNEL_LABEL[r.channel]}</strong>
                          {' · '}{r.event_types.length ? r.event_types.map(t => EVENT_LABELS[t as keyof typeof EVENT_LABELS] ?? t).join(', ') : 'all events'}
                          {r.quiet_start && r.quiet_end && ` · quiet ${r.quiet_start}–${r.quiet_end} HST`}
                          {r.user_id && r.user_id !== ws.user.id && ' · another member'}
                          {muted && <> · <Badge variant="muted">muted</Badge></>}
                          {r.unsubscribed_at && <> · <Badge variant="muted">unsubscribed</Badge></>}
                          {!r.active && <> · <Badge variant="muted">inactive</Badge></>}
                        </span>
                        <span className="flex gap-3">
                          <form action={muteRuleAction}><input type="hidden" name="rule_id" value={r.id} /><input type="hidden" name="hours" value={muted || r.unsubscribed_at ? '0' : '24'} /><button type="submit" className="underline">{muted || r.unsubscribed_at ? 'Resume' : 'Mute 24h'}</button></form>
                          <form action={deleteRuleAction}><input type="hidden" name="rule_id" value={r.id} /><button type="submit" className="underline">Delete</button></form>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
              {ws.features.alerts ? (
                <ActionForm action={createRuleAction} submit="Create alert" variant="secondary">
                  <input type="hidden" name="watchlist_id" value={l.id} />
                  <div className="grid sm:grid-cols-3 gap-3">
                    <div><label htmlFor={`ch-${l.id}`} className="block text-sm font-bold mb-1">Channel</label>
                      <select id={`ch-${l.id}`} name="channel" className={inputClass}>
                        <option value="email">{CHANNEL_LABEL.email}</option><option value="digest_daily">{CHANNEL_LABEL.digest_daily}</option>
                        <option value="digest_weekly">{CHANNEL_LABEL.digest_weekly}</option>{ws.team.slack_webhook_enc && <option value="slack">{CHANNEL_LABEL.slack}</option>}
                      </select></div>
                    <div><label htmlFor={`qs-${l.id}`} className="block text-sm font-bold mb-1">Quiet from (HST)</label><input id={`qs-${l.id}`} type="time" name="quiet_start" className={inputClass} /></div>
                    <div><label htmlFor={`qe-${l.id}`} className="block text-sm font-bold mb-1">Quiet until (HST)</label><input id={`qe-${l.id}`} type="time" name="quiet_end" className={inputClass} /></div>
                  </div>
                  <fieldset className="mt-3">
                    <legend className="text-sm font-bold mb-1">Events (none checked = all)</legend>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1 text-sm">
                      {ALERT_EVENT_TYPES.map(t => <label key={t} className="flex items-center gap-2"><input type="checkbox" name="event_types" value={t} />{EVENT_LABELS[t]}</label>)}
                    </div>
                  </fieldset>
                </ActionForm>
              ) : <p className="text-sm text-muted">Upgrade to receive alerts on this list. <Link href="/pricing">See plans</Link>.</p>}
            </div>
          </section>
        )
      })}
    </div>
  )
}
