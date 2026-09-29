/**
 * Alert matcher (E2 step 1). Runs after every ingestion batch commits (workers/import.ts,
 * /api/cron/ingest) and on the alerts worker tick. Evaluates documents and edges that arrived since
 * the last watermark against every active app.alert_rule and writes app.alert_event rows plus one
 * pending app.alert_delivery per recipient.
 *
 * Idempotent: events are unique on (team_id, dedup_key) and deliveries on (user_id, dedup_key), so
 * re-scanning an overlapping window never produces a second alert. The dedup key does not include
 * the team, so a user in two teams watching the same bill gets one alert.
 */
import { createHash } from 'node:crypto'
import type { Db } from '@/lib/db/types'
import { CHANNEL_PRIORITY, DIGEST_CHANNELS, WATCHED_EDGE_TYPES, classifyStatus, committeeCodes, type AlertEventType } from './events'
import { digestTime, inQuietHours, quietEnd } from './time'

export const MATCHER_KEY = 'alerts'
/** Re-scan this far behind the watermark so rows from transactions that committed late are not missed. */
const OVERLAP_MS = 2 * 60_000
/** First run: look back this far instead of scanning the whole corpus. */
const INITIAL_LOOKBACK_MS = 15 * 60_000
const DEADLINE_WINDOW_MS = 48 * 3600_000
const TESTIMONY_LEAD_MS = 24 * 3600_000

export interface RuleRow {
  rule_id: string
  user_id: string | null
  channel: string
  event_types: string[]
  quiet_start: string | null
  quiet_end: string | null
  watchlist_id: string
  team_id: string
}

interface ItemRow { watchlist_id: string; entity_id: string | null; keyword: string | null; committee_entity_id: string | null; source_key: string | null; position: string | null }

interface DocRow {
  id: string; source: string; source_record_id: string | null; doc_type: string; title: string | null; url: string | null
  fetched_at: string; source_posted_at: string | null; current_status: string | null; last_status: string | null; last_status_date: string | null
}

interface EdgeRowX {
  id: string; type: string; from_id: string | null; to_id: string | null; role: string | null; document_id: string; amount: string | null
  from_kind: string | null; to_kind: string | null; from_name: string | null; to_name: string | null; from_name_raw: string | null; to_name_raw: string | null
  doc_title: string | null; doc_type: string; fetched_at: string; source_posted_at: string | null
}

export interface Candidate {
  watchlistId: string
  type: AlertEventType
  dedupKey: string
  entityId: string | null
  documentId: string | null
  edgeId: string | null
  headline: string
  detail: Record<string, unknown>
  fetchedAt: string | null
  sourcePostedAt: string | null
}

export interface MatchResult {
  windowStart: string
  windowEnd: string
  documents: number
  edges: number
  candidates: number
  events: number
  deliveries: number
  durationMs: number
}

const short = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16)
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export async function loadActiveRules(db: Db, now: Date): Promise<RuleRow[]> {
  return db.many<RuleRow>(
    `select r.id rule_id, r.user_id, r.channel, r.event_types, r.quiet_start::text quiet_start, r.quiet_end::text quiet_end,
            w.id watchlist_id, w.team_id
       from app.alert_rule r join app.watchlist w on w.id = r.watchlist_id join app.team t on t.id = w.team_id
      where r.active and r.unsubscribed_at is null and (r.muted_until is null or r.muted_until <= $1)
        and (app.team_features(w.team_id)).alerts
        and (r.channel <> 'slack' or t.slack_webhook_enc is not null)
        and (r.user_id is null or exists (select 1 from app.team_member m where m.team_id = w.team_id and m.user_id = r.user_id
                                            and m.joined_at is not null and m.removed_at is null))`, [now.toISOString()])
}

/** Run one matcher pass. `since`/`until` override the stored watermark (tests, backfills). */
export async function runMatcher(db: Db, opts: { now?: Date; since?: Date; until?: Date; key?: string } = {}): Promise<MatchResult> {
  const started = Date.now()
  const now = opts.now ?? new Date()
  const key = opts.key ?? MATCHER_KEY
  const dbNow = new Date((await db.one<{ now: string }>(`select now()::text now`))!.now)
  const until = opts.until ?? dbNow
  const state = await db.one<{ watermark: string }>(`select watermark::text watermark from app.matcher_state where key = $1`, [key])
  const since = opts.since ?? (state ? new Date(new Date(state.watermark).getTime() - OVERLAP_MS) : new Date(until.getTime() - INITIAL_LOOKBACK_MS))
  const result: MatchResult = { windowStart: since.toISOString(), windowEnd: until.toISOString(), documents: 0, edges: 0, candidates: 0, events: 0, deliveries: 0, durationMs: 0 }

  const rules = await loadActiveRules(db, now)
  if (rules.length) {
    const watchlistIds = [...new Set(rules.map(r => r.watchlist_id))]
    const items = await db.many<ItemRow>(
      `select watchlist_id, entity_id, keyword, committee_entity_id, source_key, position from app.watchlist_item where watchlist_id = any($1::uuid[])`, [watchlistIds])
    const docs = await db.many<DocRow>(
      `select id, source, source_record_id, doc_type, title, url, fetched_at::text fetched_at, source_posted_at::text source_posted_at,
              raw->>'currentStatus' current_status, raw->'statusHistory'->-1->>'text' last_status, raw->'statusHistory'->-1->>'date' last_status_date
         from document where fetched_at > $1 and fetched_at <= $2`, [since.toISOString(), until.toISOString()])
    const edges = await db.many<EdgeRowX>(
      `select e.id, e.type, e.from_id, e.to_id, e.role, e.document_id, e.amount::text amount, e.from_name_raw, e.to_name_raw,
              fe.kind from_kind, te.kind to_kind, fe.name from_name, te.name to_name,
              d.title doc_title, d.doc_type, d.fetched_at::text fetched_at, d.source_posted_at::text source_posted_at
         from edge e join document d on d.id = e.document_id
         left join entity fe on fe.id = e.from_id left join entity te on te.id = e.to_id
        where e.created_at > $1 and e.created_at <= $2 and e.match_status = 'matched'`, [since.toISOString(), until.toISOString()])
    result.documents = docs.length
    result.edges = edges.length
    const candidates = await buildCandidates(db, items, docs, edges, now)
    result.candidates = candidates.length
    const { events, deliveries } = await writeEvents(db, candidates, rules, now)
    result.events = events
    result.deliveries = deliveries
  }

  if (!opts.since && !opts.until) {
    await db.query(
      `insert into app.matcher_state(key, watermark) values ($1, $2) on conflict (key) do update set watermark = greatest(app.matcher_state.watermark, excluded.watermark), updated_at = now()`,
      [key, until.toISOString()])
  }
  result.durationMs = Date.now() - started
  return result
}

// ------------------------------------------------------------------------------------------------ candidates

async function buildCandidates(db: Db, items: ItemRow[], docs: DocRow[], edges: EdgeRowX[], now: Date): Promise<Candidate[]> {
  const out: Candidate[] = []
  const byEntity = new Map<string, ItemRow[]>()
  const byCommittee = new Map<string, ItemRow[]>()
  const bySource = new Map<string, ItemRow[]>()
  const keywords: ItemRow[] = []
  for (const i of items) {
    if (i.entity_id) push(byEntity, i.entity_id, i)
    else if (i.committee_entity_id) push(byCommittee, i.committee_entity_id, i)
    else if (i.source_key) push(bySource, i.source_key, i)
    else if (i.keyword) keywords.push(i)
  }

  // Entity facts for watched entities (bill status, committee codes).
  const watchedIds = [...new Set([...byEntity.keys(), ...byCommittee.keys()])]
  const entities = watchedIds.length ? await db.many<{ id: string; kind: string; name: string; identifiers: Record<string, string>; attributes: Record<string, unknown>; aliases: string[] }>(
    `select id, kind, name, identifiers, attributes, aliases from entity where id = any($1::uuid[])`, [watchedIds]) : []
  const entityById = new Map(entities.map(e => [e.id, e]))

  // Committees: code → watching items.
  const committeeByCode = new Map<string, ItemRow[]>()
  for (const [id, list] of byCommittee) {
    const e = entityById.get(id)
    if (!e) continue
    const codes = new Set<string>()
    for (const v of [e.identifiers?.committee_code, e.attributes?.code as string | undefined, ...(e.aliases ?? []), e.name]) {
      const c = typeof v === 'string' ? v.replace(/^\d{4}:[HS]:/, '').trim().toUpperCase() : ''
      if (/^[A-Z]{2,4}$/.test(c)) codes.add(c)
    }
    for (const c of codes) for (const i of list) push(committeeByCode, c, i)
  }

  // Measure documents → bill entity ids (identifiers.measure = source_record_id).
  const measureDocs = docs.filter(d => d.doc_type === 'measure' && d.source_record_id)
  const billIdByMeasure = new Map<string, { id: string; name: string }>()
  if (measureDocs.length) {
    const rows = await db.many<{ id: string; name: string; measure: string }>(
      `select e.id, e.name, e.identifiers->>'measure' measure from entity e
        where e.kind = 'bill' and e.identifiers->>'measure' = any($1::text[])`, [measureDocs.map(d => d.source_record_id!)])
    for (const r of rows) billIdByMeasure.set(r.measure, { id: r.id, name: r.name })
  }

  for (const d of docs) {
    const base = { documentId: d.id, edgeId: null, fetchedAt: d.fetched_at, sourcePostedAt: d.source_posted_at }
    // Bill status lines.
    if (d.doc_type === 'measure' && d.source_record_id) {
      const bill = billIdByMeasure.get(d.source_record_id)
      const status = d.last_status ?? d.current_status
      if (bill && status) {
        const cls = classifyStatus(status)
        const statusKey = short(`${d.last_status_date ?? ''}|${status}`)
        for (const i of byEntity.get(bill.id) ?? []) {
          out.push({ ...base, watchlistId: i.watchlist_id, type: cls.type, entityId: bill.id, dedupKey: `bill:${bill.id}:${statusKey}`,
            headline: `${bill.name}: ${status}`, detail: { status, status_date: d.last_status_date, position: i.position } })
        }
        for (const code of cls.committees) {
          for (const i of committeeByCode.get(code) ?? []) {
            const type: AlertEventType = cls.type === 'bill.hearing_scheduled' || cls.type === 'bill.hearing_changed' || cls.type === 'bill.hearing_canceled' ? 'committee.hearing_notice' : 'committee.referral'
            out.push({ ...base, watchlistId: i.watchlist_id, type, entityId: i.committee_entity_id, dedupKey: `committee:${code}:${bill.id}:${statusKey}`,
              headline: `${code}: ${bill.name} — ${status}`, detail: { status, committee: code, bill_id: bill.id } })
          }
        }
      }
    }
    // Hearing notices and agendas that name a watched committee.
    if (d.doc_type === 'agenda' || d.doc_type === 'event') {
      for (const code of committeeCodes(d.title ?? '')) {
        for (const i of committeeByCode.get(code) ?? []) {
          out.push({ ...base, watchlistId: i.watchlist_id, type: 'committee.hearing_notice', entityId: i.committee_entity_id, dedupKey: `doc:${d.id}:committee`,
            headline: d.title ?? `${code} hearing notice`, detail: { committee: code } })
        }
      }
    }
    // Watched sources.
    for (const i of bySource.get(d.source) ?? []) {
      out.push({ ...base, watchlistId: i.watchlist_id, type: 'source.new_document', entityId: null, dedupKey: `doc:${d.id}:source`,
        headline: d.title ?? `New ${d.doc_type.replace(/_/g, ' ')} from ${d.source}`, detail: { source: d.source, doc_type: d.doc_type } })
    }
  }

  // Keywords: word-boundary, case-insensitive match against title + body_text of new documents.
  if (keywords.length && docs.length) {
    const terms = [...new Set(keywords.map(k => k.keyword!.trim().toLowerCase()).filter(Boolean))]
    const hits = await db.many<{ id: string; term: string }>(
      `select d.id, t.term from document d cross join unnest($2::text[], $3::text[]) as t(term, re)
        where d.id = any($1::uuid[]) and (coalesce(d.title, '') || ' ' || coalesce(d.body_text, '')) ~* ('\\m' || t.re || '\\M')`,
      [docs.map(d => d.id), terms, terms.map(escapeRegex)])
    const docById = new Map(docs.map(d => [d.id, d]))
    for (const h of hits) {
      const d = docById.get(h.id)!
      for (const i of keywords.filter(k => k.keyword!.trim().toLowerCase() === h.term)) {
        out.push({ watchlistId: i.watchlist_id, type: 'keyword.match', entityId: null, documentId: d.id, edgeId: null, dedupKey: `doc:${d.id}:keyword`,
          headline: `“${i.keyword}” in ${d.title ?? d.doc_type.replace(/_/g, ' ')}`, detail: { keyword: i.keyword, source: d.source, doc_type: d.doc_type },
          fetchedAt: d.fetched_at, sourcePostedAt: d.source_posted_at })
      }
    }
  }

  // Edges touching watched entities.
  for (const e of edges) {
    const base = { documentId: e.document_id, edgeId: e.id, fetchedAt: e.fetched_at, sourcePostedAt: e.source_posted_at }
    for (const side of ['from', 'to'] as const) {
      const id = side === 'from' ? e.from_id : e.to_id
      if (!id) continue
      const watching = byEntity.get(id)
      if (!watching) continue
      const kind = side === 'from' ? e.from_kind : e.to_kind
      const selfName = (side === 'from' ? e.from_name : e.to_name) ?? ''
      const other = (side === 'from' ? e.to_name ?? e.to_name_raw : e.from_name ?? e.from_name_raw) ?? ''
      let type: AlertEventType | null = null
      let dedupKey = ''
      if (kind === 'bill' && e.type === 'voted_on') { type = 'bill.vote_recorded'; dedupKey = `vote:${e.document_id}:${id}` }
      else if (kind === 'bill' && e.type === 'testified_on') { type = 'bill.new_testimony'; dedupKey = `testimony:${e.document_id}:${id}` }
      else if (e.type === 'mentioned_in') { type = 'entity.mention'; dedupKey = `mention:${e.document_id}:${id}` }
      else if (kind !== 'bill' && WATCHED_EDGE_TYPES.has(e.type)) { type = 'entity.new_edge'; dedupKey = `edge:${e.document_id}:${id}:${e.type}` }
      else if (kind === 'bill' && (e.type === 'lobbied_on')) { type = 'entity.new_edge'; dedupKey = `edge:${e.document_id}:${id}:${e.type}` }
      if (!type) continue
      const verb = e.type.replace(/_/g, ' ')
      const headline = type === 'entity.mention' ? `${selfName} mentioned in ${e.doc_title ?? 'a new document'}`
        : type === 'bill.vote_recorded' ? `${selfName}: vote recorded`
        : type === 'bill.new_testimony' ? `${selfName}: new testimony filed`
        : side === 'from' ? `${selfName} ${verb} ${other}`.trim() : `${other} ${verb} ${selfName}`.trim()
      for (const i of watching) {
        out.push({ ...base, watchlistId: i.watchlist_id, type, entityId: id, dedupKey, headline,
          detail: { edge_type: e.type, role: e.role, amount: e.amount, counterpart: other } })
      }
    }
  }

  // Testimony deadlines within 48 hours for watched bills with a scheduled hearing.
  for (const [id, list] of byEntity) {
    const e = entityById.get(id)
    if (!e || e.kind !== 'bill') continue
    const status = typeof e.attributes?.current_status === 'string' ? e.attributes.current_status : null
    if (!status) continue
    const cls = classifyStatus(status)
    if (cls.type !== 'bill.hearing_scheduled' && cls.type !== 'bill.hearing_changed') continue
    if (!cls.hearingAt) continue
    const deadline = new Date(cls.hearingAt.getTime() - TESTIMONY_LEAD_MS)
    if (deadline.getTime() <= now.getTime() || deadline.getTime() - now.getTime() > DEADLINE_WINDOW_MS) continue
    for (const i of list) {
      out.push({ watchlistId: i.watchlist_id, type: 'bill.testimony_deadline', entityId: id, documentId: null, edgeId: null,
        dedupKey: `deadline:${id}:${cls.hearingAt.toISOString()}`, headline: `${e.name}: testimony due ${deadline.toISOString()}`,
        detail: { hearing_at: cls.hearingAt.toISOString(), deadline: deadline.toISOString(), status }, fetchedAt: null, sourcePostedAt: null })
    }
  }
  return out
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k)
  if (list) list.push(v)
  else m.set(k, [v])
}

// ------------------------------------------------------------------------------------------------ events + deliveries

interface EventDraft { team_id: string; watchlist_id: string; rules: RuleRow[]; c: Candidate }

async function writeEvents(db: Db, candidates: Candidate[], rules: RuleRow[], now: Date): Promise<{ events: number; deliveries: number }> {
  const rulesByWatchlist = new Map<string, RuleRow[]>()
  for (const r of rules) push(rulesByWatchlist, r.watchlist_id, r)

  // Group candidates into one event per (team, dedup key), collecting every matching rule.
  const drafts = new Map<string, EventDraft>()
  for (const c of candidates) {
    for (const r of rulesByWatchlist.get(c.watchlistId) ?? []) {
      if (r.event_types.length && !r.event_types.includes(c.type)) continue
      const k = `${r.team_id}|${c.dedupKey}`
      const d = drafts.get(k)
      if (d) { if (!d.rules.includes(r)) d.rules.push(r) }
      else drafts.set(k, { team_id: r.team_id, watchlist_id: c.watchlistId, rules: [r], c })
    }
  }
  if (!drafts.size) return { events: 0, deliveries: 0 }

  const list = [...drafts.values()]
  let events = 0, deliveries = 0
  for (let s = 0; s < list.length; s += 1000) {
    const chunk = list.slice(s, s + 1000)
    const rows = chunk.map(d => ({
      team_id: d.team_id, watchlist_id: d.watchlist_id, rule_ids: `{${d.rules.map(r => r.rule_id).join(',')}}`, event_type: d.c.type,
      dedup_key: d.c.dedupKey, document_id: d.c.documentId, edge_id: d.c.edgeId, entity_id: d.c.entityId, headline: d.c.headline.slice(0, 500),
      detail: d.c.detail, source_posted_at: d.c.sourcePostedAt, fetched_at: d.c.fetchedAt,
    }))
    const inserted = await db.many<{ id: string; team_id: string; dedup_key: string }>(
      `insert into app.alert_event(team_id, watchlist_id, rule_ids, event_type, dedup_key, document_id, edge_id, entity_id, headline, detail, source_posted_at, fetched_at)
       select team_id, watchlist_id, rule_ids::uuid[], event_type, dedup_key, document_id, edge_id, entity_id, headline, detail, source_posted_at, fetched_at
         from jsonb_to_recordset($1::jsonb) as x(team_id uuid, watchlist_id uuid, rule_ids text, event_type text, dedup_key text, document_id uuid,
                                                 edge_id uuid, entity_id uuid, headline text, detail jsonb, source_posted_at timestamptz, fetched_at timestamptz)
       on conflict (team_id, dedup_key) do nothing
       returning id, team_id, dedup_key`, [JSON.stringify(rows)])
    events += inserted.length
    const byKey = new Map(chunk.map(d => [`${d.team_id}|${d.c.dedupKey}`, d]))
    const deliveryRows: Array<Record<string, unknown>> = []
    const seenUser = new Set<string>()
    for (const ev of inserted) {
      const d = byKey.get(`${ev.team_id}|${ev.dedup_key}`)!
      const sorted = [...d.rules].sort((a, b) => channelRank(a.channel) - channelRank(b.channel))
      for (const r of sorted) {
        const recipientKey = r.user_id ? `u:${r.user_id}|${ev.dedup_key}` : `t:${ev.team_id}|${r.channel}|${ev.dedup_key}`
        if (seenUser.has(recipientKey)) continue
        seenUser.add(recipientKey)
        let status = 'pending'
        let scheduledFor = now
        if (DIGEST_CHANNELS.has(r.channel)) scheduledFor = digestTime(r.channel as 'digest_daily' | 'digest_weekly', now)
        else if (r.channel === 'sms') status = 'skipped'
        else if (inQuietHours(now, r.quiet_start, r.quiet_end)) { status = 'deferred'; scheduledFor = quietEnd(now, r.quiet_end!) }
        deliveryRows.push({ alert_event_id: ev.id, team_id: ev.team_id, rule_id: r.rule_id, user_id: r.user_id, channel: r.channel,
          dedup_key: ev.dedup_key, status, scheduled_for: scheduledFor.toISOString(), error: status === 'skipped' ? 'SMS delivery is not enabled' : null })
      }
    }
    if (deliveryRows.length) {
      const res = await db.query(
        `insert into app.alert_delivery(alert_event_id, team_id, rule_id, user_id, channel, dedup_key, status, scheduled_for, error)
         select alert_event_id, team_id, rule_id, user_id, channel, dedup_key, status, scheduled_for, error
           from jsonb_to_recordset($1::jsonb) as x(alert_event_id uuid, team_id uuid, rule_id uuid, user_id text, channel text, dedup_key text,
                                                   status text, scheduled_for timestamptz, error text)
         on conflict do nothing`, [JSON.stringify(deliveryRows)])
      deliveries += res.rowCount
    }
  }
  return { events, deliveries }
}

function channelRank(c: string): number {
  const i = (CHANNEL_PRIORITY as readonly string[]).indexOf(c)
  return i < 0 ? CHANNEL_PRIORITY.length : i
}
