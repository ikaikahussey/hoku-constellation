/**
 * Workspace context for signed-in pages and actions: session user, entitlements, and the active team
 * (cookie `hoku_team` when the user belongs to it; otherwise the best-plan team). A personal team is
 * created on first visit, so every user can build watchlists right after sign-up.
 */
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getCurrentUser, type UserWithAccount } from '@/lib/auth'
import { getServiceDb } from '@/lib/db/service'
import type { Db } from '@/lib/db/types'
import { ensureActiveTeam, getUserTeams, type TeamRole, type TeamRow } from '@/lib/teams'
import { getTeamEntitlements, type Entitlements } from '@/lib/entitlements'

export const TEAM_COOKIE = 'hoku_team'

export interface Workspace {
  db: Db
  user: UserWithAccount
  team: TeamRow & { role: TeamRole; tier: string }
  teams: Array<TeamRow & { role: TeamRole; tier: string }>
  /** Features of the active team (what this workspace can do). */
  features: Entitlements
  isAdmin: boolean
}

export async function getWorkspace(): Promise<Workspace | null> {
  const user = await getCurrentUser()
  if (!user) return null
  const db = await getServiceDb()
  await ensureActiveTeam(db, user.id, user.email)
  // Keep the member email current (used for alert and report notices).
  await db.query(`update app.team_member set email = $2 where user_id = $1 and (email is null or email <> $2)`, [user.id, user.email.toLowerCase()])
  const teams = await getUserTeams(db, user.id)
  const wanted = (await cookies()).get(TEAM_COOKIE)?.value
  const team = teams.find(t => t.id === wanted) ?? teams[0]
  const features = await getTeamEntitlements(db, team.id)
  if (user.isStaff) Object.assign(features, { ...user.entitlements, tier: features.tier })
  return { db, user, team, teams, features, isAdmin: team.role === 'owner' || team.role === 'admin' }
}

export async function requireWorkspace(next = '/workspace'): Promise<Workspace> {
  const ws = await getWorkspace()
  if (!ws) redirect(`/auth/login?next=${encodeURIComponent(next)}`)
  return ws
}

export async function logUsage(db: Db, teamId: string, userId: string, kind: string, entityId?: string | null) {
  await db.query(`insert into app.usage_event(team_id, user_id, kind, entity_id) values ($1, $2, $3, $4)`, [teamId, userId, kind, entityId ?? null])
}

/** Usage kinds recorded for the design-partner dashboard. */
export const USAGE = {
  LOGIN: 'session.active',
  BRIEFING: 'briefing.viewed',
  REPORT_GENERATED: 'report.generated',
  REPORT_SENT: 'report.sent',
  QA: 'qa.asked',
} as const
