/**
 * Entitlements — the single source for what a user may do. Mirrors app.plan_features() and
 * app.entitlements(user_id) in db/migrations/003_app_workspace.sql; the database enforces the same
 * rules through RLS, so these helpers only produce early 403s and paywall UI.
 */
import type { Db } from '@/lib/db/types'

export const TIERS = ['free', 'reader', 'pro', 'organization'] as const
export type Tier = (typeof TIERS)[number]

export interface Entitlements {
  tier: Tier
  is_staff: boolean
  paid_content: boolean
  alerts: boolean
  /** null = unlimited */
  max_watch_items: number | null
  reports: boolean
  briefings: boolean
  dossiers: boolean
  qa: boolean
  /** Questions per seat per day. */
  qa_daily_limit: number
  exports: boolean
  api: boolean
  custom_letterhead: boolean
  invoice_billing: boolean
  priority_support: boolean
}

export type Feature = Exclude<keyof Entitlements, 'tier' | 'is_staff' | 'max_watch_items' | 'qa_daily_limit'>

const f = (tier: Tier, flags: Omit<Entitlements, 'tier' | 'is_staff'>): Entitlements => ({ tier, is_staff: false, ...flags })

export const PLAN_FEATURES: Record<Tier, Entitlements> = {
  free: f('free', { paid_content: false, alerts: false, max_watch_items: 10, reports: false, briefings: false, dossiers: false, qa: false, qa_daily_limit: 0, exports: false, api: false, custom_letterhead: false, invoice_billing: false, priority_support: false }),
  reader: f('reader', { paid_content: true, alerts: true, max_watch_items: 10, reports: false, briefings: false, dossiers: false, qa: false, qa_daily_limit: 0, exports: false, api: false, custom_letterhead: false, invoice_billing: false, priority_support: false }),
  pro: f('pro', { paid_content: true, alerts: true, max_watch_items: null, reports: true, briefings: true, dossiers: true, qa: true, qa_daily_limit: 100, exports: true, api: false, custom_letterhead: false, invoice_billing: false, priority_support: false }),
  organization: f('organization', { paid_content: true, alerts: true, max_watch_items: null, reports: true, briefings: true, dossiers: true, qa: true, qa_daily_limit: 300, exports: true, api: true, custom_letterhead: true, invoice_billing: true, priority_support: true }),
}

export const tierRank = (t: string): number => ({ organization: 3, pro: 2, reader: 1 } as Record<string, number>)[t] ?? 0

export const FREE_ENTITLEMENTS: Entitlements = PLAN_FEATURES.free

/** Entitlements for a user via app.entitlements(). Service-role callers only (the function checks the caller). */
export async function getEntitlements(db: Db, userId: string | null | undefined): Promise<Entitlements> {
  if (!userId) return FREE_ENTITLEMENTS
  const row = await db.one<Entitlements>(`select (app.entitlements($1)).*`, [userId])
  return row ? { ...row, tier: (TIERS as readonly string[]).includes(row.tier) ? row.tier : 'free' } : FREE_ENTITLEMENTS
}

/** Effective tier and features for a team (plan while subscription is active, or a design partner). */
export async function getTeamEntitlements(db: Db, teamId: string): Promise<Entitlements> {
  const row = await db.one<Entitlements>(`select (app.team_features($1)).*`, [teamId])
  return row ?? FREE_ENTITLEMENTS
}

export class EntitlementError extends Error {
  status = 403
  constructor(public feature: string, public tier: string) {
    super(`${feature} is not included in the ${tier} plan`)
  }
}

export function requireFeature(e: Entitlements, feature: Feature): void {
  if (!e[feature]) throw new EntitlementError(feature, e.tier)
}
