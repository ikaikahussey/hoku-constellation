/**
 * Staff tool behind scripts/db/prioritize.ts: flag people or organizations as priority, optionally
 * feature them, and put them on a team's watchlist with immediate email alerts.
 *
 * Resolution never guesses. An entity is used when its name or an alias normalizes to one of the
 * supplied names, or when exactly one fuzzy candidate reaches the automatic-match threshold. Several
 * candidates, or none, are reported back for staff to pick an id (`--id`). A missing entity is created
 * only with `create: true`: a staff-curated profile, the same as adding one in /admin.
 */
import type { Db } from '@/lib/db/types'
import { fuzzyMatch, normalize, normalizeOrg, canonicalPersonName, autoMatchThreshold } from '@/lib/entity-match'
import { createEntity } from '@/lib/import/pipeline'
import { getUserTeams } from '@/lib/teams'
import { createAlertRule } from '@/lib/alerts/rules'

export interface PrioritySpec {
  kind: 'person' | 'org'
  /** Display name, then aliases (other spellings, nicknames, "Last, First" forms). */
  names: string[]
  /** Use this entity instead of resolving by name. */
  id?: string
}

export type PriorityResolution =
  | { status: 'found' | 'created'; spec: PrioritySpec; entityId: string; name: string }
  | { status: 'ambiguous' | 'missing'; spec: PrioritySpec; candidates: Array<{ id: string; name: string; confidence: number }> }

export async function resolvePrioritySpec(db: Db, spec: PrioritySpec, opts: { create?: boolean } = {}): Promise<PriorityResolution> {
  if (spec.id) {
    const e = await db.one<{ id: string; name: string }>(`select id, name from entity where id = $1 and kind = $2 and merged_into_id is null`, [spec.id, spec.kind])
    return e ? { status: 'found', spec, entityId: e.id, name: e.name } : { status: 'missing', spec, candidates: [] }
  }
  const norm = (s: string) => spec.kind === 'org' ? normalizeOrg(s) : normalize(canonicalPersonName(s))
  const wanted = new Set(spec.names.map(norm).filter(Boolean))
  const seen = new Map<string, { id: string; name: string; confidence: number }>()
  for (const n of spec.names) for (const c of await fuzzyMatch(db, n, { kind: spec.kind, limit: 10 })) {
    const prev = seen.get(c.id)
    if (!prev || prev.confidence < c.confidence) seen.set(c.id, c)
  }
  const candidates = [...seen.values()].sort((a, b) => b.confidence - a.confidence)
  // Exact: the entity's name or an alias normalizes to a supplied name.
  const exact: typeof candidates = []
  for (const c of candidates) {
    const row = await db.one<{ name: string; aliases: string[] }>(`select name, aliases from entity where id = $1 and merged_into_id is null`, [c.id])
    if (row && [row.name, ...row.aliases].some(x => wanted.has(norm(x)))) exact.push(c)
  }
  const strong = candidates.filter(c => autoMatchThreshold(c.confidence) === 'matched')
  const pick = exact.length === 1 ? exact[0] : exact.length === 0 && strong.length === 1 ? strong[0] : null
  if (pick) return { status: 'found', spec, entityId: pick.id, name: pick.name }
  if (exact.length > 1 || strong.length > 1) return { status: 'ambiguous', spec, candidates: (exact.length > 1 ? exact : strong).slice(0, 10) }
  if (opts.create) {
    const [name] = spec.names
    const id = await createEntity(db, { kind: spec.kind, rawName: name, canonicalName: name, aliases: spec.names.slice(1),
      attributes: spec.kind === 'person' ? { entity_types: ['person'], status: 'active' } : { status: 'active' } }, {})
    return { status: 'created', spec, entityId: id, name }
  }
  return { status: 'missing', spec, candidates: candidates.slice(0, 10) }
}

/** Flag as priority (and optionally featured); add the supplied names as aliases. Idempotent. */
export async function markPriority(db: Db, entityId: string, names: string[], opts: { feature?: boolean } = {}): Promise<void> {
  const attrs: Record<string, boolean> = { is_priority: true }
  if (opts.feature) attrs.is_featured = true
  await db.query(
    `update entity set
        attributes = attributes || $2::jsonb,
        aliases = (select coalesce(array_agg(distinct a order by a), '{}') from unnest(aliases || $3::text[]) a where a is not null and lower(a) <> lower(name)),
        updated_at = now()
      where id = $1`, [entityId, JSON.stringify(attrs), names])
}

export async function clearPriority(db: Db, entityId: string): Promise<void> {
  await db.query(`update entity set attributes = attributes - 'is_priority', updated_at = now() where id = $1`, [entityId])
}

export interface WatchResult { teamId: string; teamName: string; watchlistId: string; added: number; ruleId: string | null; ruleError: string | null }

export const PRIORITY_WATCHLIST = 'Priority'

/**
 * Watch the entities from a team: a "Priority" watchlist (created once) with each entity at
 * priority 1, and an immediate email rule for `userId` if the plan includes alerts.
 * The team is `teamId`, or the user's working team (best plan) when only `userId` is given.
 */
export async function watchForTeam(db: Db, entityIds: string[], target: { teamId?: string; userId?: string }): Promise<WatchResult> {
  let teamId = target.teamId
  if (!teamId) {
    if (!target.userId) throw new Error('watchForTeam: teamId or userId required')
    const teams = await getUserTeams(db, target.userId)
    if (!teams.length) throw new Error('That user has no team yet; they need to open /workspace once')
    teamId = teams[0].id
  }
  const team = await db.one<{ id: string; name: string }>(`select id, name from app.team where id = $1`, [teamId])
  if (!team) throw new Error(`Team ${teamId} not found`)
  if (target.userId) {
    const member = await db.one(`select 1 from app.team_member where team_id = $1 and user_id = $2 and joined_at is not null and removed_at is null`, [teamId, target.userId])
    if (!member) throw new Error('That user is not a member of the team')
  }
  const wl = (await db.one<{ id: string }>(`select id from app.watchlist where team_id = $1 and name = $2 and owner_user_id is null order by created_at limit 1`, [teamId, PRIORITY_WATCHLIST]))
    ?? (await db.one<{ id: string }>(`insert into app.watchlist(team_id, name) values ($1, $2) returning id`, [teamId, PRIORITY_WATCHLIST]))!
  let added = 0
  for (const id of entityIds) {
    const r = await db.query(`insert into app.watchlist_item(watchlist_id, entity_id, position, priority) values ($1, $2, 'monitor', 1) on conflict do nothing`, [wl.id, id])
    added += r.rowCount
  }
  let ruleId: string | null = null
  let ruleError: string | null = null
  if (target.userId) {
    const existing = await db.one<{ id: string }>(`select id from app.alert_rule where watchlist_id = $1 and user_id = $2 and channel = 'email' and unsubscribed_at is null`, [wl.id, target.userId])
    if (existing) ruleId = existing.id
    else {
      try { ruleId = (await createAlertRule(db, { watchlistId: wl.id, userId: target.userId, channel: 'email' })).id }
      catch (e) { ruleError = (e as Error).message }
    }
  }
  return { teamId, teamName: team.name, watchlistId: wl.id, added, ruleId, ruleError }
}

/** Neon Auth user id for a team member's email (the address recorded on their membership). */
export async function userIdForEmail(db: Db, email: string): Promise<string | null> {
  return (await db.one<{ user_id: string }>(
    `select user_id from app.team_member where lower(email) = lower($1) and joined_at is not null and removed_at is null order by joined_at limit 1`, [email]))?.user_id ?? null
}
