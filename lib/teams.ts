/**
 * Team accounts (E6). Membership writes go through these functions with the service Db; each one
 * checks the acting user's role first. RLS lets members read their team but not change membership.
 *
 * Seats: active members + pending invitations may not exceed team.seat_count. Removing a member
 * keeps their notes with the team (notes are keyed by team_id; author_user_id is informational).
 */
import { createHash, randomBytes } from 'node:crypto'
import type { Db } from '@/lib/db/types'

export type TeamRole = 'owner' | 'admin' | 'member'

export interface TeamRow {
  id: string
  name: string
  plan: 'free' | 'reader' | 'pro' | 'organization'
  subscription_status: string
  billing_interval: 'month' | 'year' | null
  collection_method: 'charge_automatically' | 'send_invoice'
  po_number: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  seat_count: number
  logo_key: string | null
  letterhead_key: string | null
  sender_name: string | null
  slack_webhook_enc: string | null
  is_personal: boolean
  is_design_partner: boolean
  coupon_code: string | null
  created_at: string
}

export interface MemberRow { team_id: string; user_id: string; role: TeamRole; email: string | null; invited_at: string; joined_at: string | null; removed_at: string | null }

export class TeamError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
export const newToken = () => randomBytes(24).toString('base64url')

export async function getRole(db: Db, teamId: string, userId: string): Promise<TeamRole | null> {
  const r = await db.one<{ role: TeamRole }>(
    `select role from app.team_member where team_id = $1 and user_id = $2 and joined_at is not null and removed_at is null`, [teamId, userId])
  return r?.role ?? null
}

async function requireRole(db: Db, teamId: string, userId: string, roles: TeamRole[]): Promise<TeamRole> {
  const role = await getRole(db, teamId, userId)
  if (!role) throw new TeamError('Not a member of this team', 403)
  if (!roles.includes(role)) throw new TeamError(`Requires ${roles.join(' or ')}`, 403)
  return role
}

export async function createTeam(db: Db, ownerUserId: string, name: string, opts: { email?: string | null; personal?: boolean } = {}): Promise<TeamRow> {
  const clean = name.trim().slice(0, 120)
  if (!clean) throw new TeamError('Team name is required')
  return db.transaction(async tx => {
    const team = (await tx.one<TeamRow>(
      `insert into app.team(name, is_personal, created_by) values ($1, $2, $3) returning *`, [clean, !!opts.personal, ownerUserId]))!
    await tx.query(`insert into app.team_member(team_id, user_id, role, email, joined_at) values ($1, $2, 'owner', $3, now())`,
      [team.id, ownerUserId, opts.email ?? null])
    await tx.query(`insert into app.watchlist(team_id, name, is_default, owner_user_id) values ($1, 'My watchlist', true, $2)`, [team.id, ownerUserId])
    return team
  })
}

/** Teams the user belongs to, best plan first. */
export async function getUserTeams(db: Db, userId: string): Promise<Array<TeamRow & { role: TeamRole; tier: string }>> {
  return db.many(
    `select t.*, m.role, app.team_tier(t.id) as tier from app.team t join app.team_member m on m.team_id = t.id
      where m.user_id = $1 and m.joined_at is not null and m.removed_at is null
      order by app.tier_rank(app.team_tier(t.id)) desc, t.is_personal, t.created_at`, [userId])
}

/** The team a signed-in user works in: the best-plan team, or a new personal team on first use. */
export async function ensureActiveTeam(db: Db, userId: string, email?: string | null): Promise<TeamRow & { role: TeamRole; tier: string }> {
  const teams = await getUserTeams(db, userId)
  if (teams.length) return teams[0]
  await createTeam(db, userId, 'Personal', { email, personal: true })
  return (await getUserTeams(db, userId))[0]
}

export async function getTeam(db: Db, teamId: string): Promise<TeamRow | null> {
  return db.one<TeamRow>(`select * from app.team where id = $1`, [teamId])
}

export async function listMembers(db: Db, teamId: string): Promise<MemberRow[]> {
  return db.many<MemberRow>(`select * from app.team_member where team_id = $1 and removed_at is null order by joined_at nulls last, invited_at`, [teamId])
}

export async function seatsUsed(db: Db, teamId: string): Promise<number> {
  const r = await db.one<{ n: number }>(
    `select ((select count(*) from app.team_member where team_id = $1 and joined_at is not null and removed_at is null)
           + (select count(*) from app.invitation where team_id = $1 and accepted_at is null and revoked_at is null and expires_at > now()))::int n`, [teamId])
  return r?.n ?? 0
}

export interface Invitation { id: string; token: string; email: string; role: 'admin' | 'member'; expiresAt: string }

export async function inviteMember(db: Db, actorUserId: string, teamId: string, email: string, role: 'admin' | 'member' = 'member'): Promise<Invitation> {
  await requireRole(db, teamId, actorUserId, ['owner', 'admin'])
  const addr = email.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) throw new TeamError('Invalid email address')
  const team = await getTeam(db, teamId)
  if (!team) throw new TeamError('Team not found', 404)
  if (await seatsUsed(db, teamId) >= team.seat_count) throw new TeamError(`All ${team.seat_count} seats are in use. Add seats before inviting.`, 409)
  const token = newToken()
  const row = (await db.one<{ id: string; expires_at: string }>(
    `insert into app.invitation(team_id, email, role, token_hash, invited_by) values ($1, $2, $3, $4, $5) returning id, expires_at`,
    [teamId, addr, role, hashToken(token), actorUserId]))!
  return { id: row.id, token, email: addr, role, expiresAt: row.expires_at }
}

export async function acceptInvitation(db: Db, token: string, userId: string, email?: string | null): Promise<{ teamId: string; role: TeamRole }> {
  return db.transaction(async tx => {
    const inv = await tx.one<{ id: string; team_id: string; role: 'admin' | 'member'; email: string }>(
      `select id, team_id, role, email from app.invitation
        where token_hash = $1 and accepted_at is null and revoked_at is null and expires_at > now() for update`, [hashToken(token)])
    if (!inv) throw new TeamError('Invitation is invalid or has expired', 404)
    if (email && inv.email !== email.trim().toLowerCase()) throw new TeamError('This invitation was sent to a different email address', 403)
    await tx.query(
      `insert into app.team_member(team_id, user_id, role, email, joined_at) values ($1, $2, $3, $4, now())
       on conflict (team_id, user_id) do update set role = excluded.role, joined_at = now(), removed_at = null`,
      [inv.team_id, userId, inv.role, inv.email])
    await tx.query(`update app.invitation set accepted_at = now(), accepted_by = $2 where id = $1`, [inv.id, userId])
    await tx.query(
      `insert into app.watchlist(team_id, name, is_default, owner_user_id) values ($1, 'My watchlist', true, $2) on conflict do nothing`,
      [inv.team_id, userId])
    return { teamId: inv.team_id, role: inv.role }
  })
}

export async function revokeInvitation(db: Db, actorUserId: string, teamId: string, invitationId: string): Promise<void> {
  await requireRole(db, teamId, actorUserId, ['owner', 'admin'])
  await db.query(`update app.invitation set revoked_at = now() where id = $1 and team_id = $2 and accepted_at is null`, [invitationId, teamId])
}

export async function setMemberRole(db: Db, actorUserId: string, teamId: string, userId: string, role: 'admin' | 'member'): Promise<void> {
  await requireRole(db, teamId, actorUserId, ['owner', 'admin'])
  const target = await getRole(db, teamId, userId)
  if (!target) throw new TeamError('Not a member', 404)
  if (target === 'owner') throw new TeamError('Transfer ownership before changing the owner’s role', 409)
  await db.query(`update app.team_member set role = $3 where team_id = $1 and user_id = $2`, [teamId, userId, role])
}

/** Remove a member. Their notes, reports, and watchlist items stay with the team. */
export async function removeMember(db: Db, actorUserId: string, teamId: string, userId: string): Promise<void> {
  const actorRole = await requireRole(db, teamId, actorUserId, actorUserId === userId ? ['owner', 'admin', 'member'] : ['owner', 'admin'])
  const target = await getRole(db, teamId, userId)
  if (!target) throw new TeamError('Not a member', 404)
  if (target === 'owner') throw new TeamError('The owner cannot be removed; transfer ownership first', 409)
  if (target === 'admin' && actorRole === 'admin' && actorUserId !== userId) throw new TeamError('Only the owner can remove an admin', 403)
  await db.transaction(async tx => {
    await tx.query(`update app.team_member set removed_at = now() where team_id = $1 and user_id = $2`, [teamId, userId])
    // Personal alert rules stop; the watchlists they built stay with the team.
    await tx.query(`update app.alert_rule set active = false where user_id = $2 and watchlist_id in (select id from app.watchlist where team_id = $1)`, [teamId, userId])
  })
}

export async function transferOwnership(db: Db, actorUserId: string, teamId: string, newOwnerUserId: string): Promise<void> {
  await requireRole(db, teamId, actorUserId, ['owner'])
  if (!(await getRole(db, teamId, newOwnerUserId))) throw new TeamError('New owner must be a team member', 404)
  await db.transaction(async tx => {
    await tx.query(`update app.team_member set role = 'admin' where team_id = $1 and user_id = $2`, [teamId, actorUserId])
    await tx.query(`update app.team_member set role = 'owner' where team_id = $1 and user_id = $2`, [teamId, newOwnerUserId])
  })
}

export async function renameTeam(db: Db, actorUserId: string, teamId: string, name: string): Promise<void> {
  await requireRole(db, teamId, actorUserId, ['owner', 'admin'])
  const clean = name.trim().slice(0, 120)
  if (!clean) throw new TeamError('Team name is required')
  await db.query(`update app.team set name = $2 where id = $1`, [teamId, clean])
}

/** Seat-count change requested by an owner/admin; Stripe quantity is updated by lib/billing.ts. */
export async function assertSeatChangeAllowed(db: Db, actorUserId: string, teamId: string, seats: number): Promise<void> {
  await requireRole(db, teamId, actorUserId, ['owner', 'admin'])
  if (!Number.isInteger(seats) || seats < 1) throw new TeamError('Seat count must be a positive integer')
  const used = await seatsUsed(db, teamId)
  if (seats < used) throw new TeamError(`${used} seats are in use (members and pending invitations); remove members first`, 409)
}
