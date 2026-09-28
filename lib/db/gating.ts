/**
 * Access gating mirrored from db/migrations/001_core_schema.sql (app.paid_doc_types / app.paid_edge_types).
 * Used by API routes for early 403s and by the paywall UI; the database enforces the same rules via RLS.
 */
import type { UserAccountRow } from './types'

export const PAID_TIERS = ['individual', 'professional', 'institutional'] as const
export const ACTIVE_STATUSES = ['active', 'trialing'] as const

export const PAID_DOC_TYPES = new Set([
  'contribution', 'expenditure', 'loan', 'lobbyist_registration', 'lobbyist_expenditure',
  'financial_disclosure', 'gift_disclosure', 'testimony', 'contract', 'grant', 'property_record',
  'source_record', 'exclusion', 'debarment',
])

export const PAID_EDGE_TYPES = new Set([
  'contributed_to', 'spent_with', 'loaned_to', 'lobbied_for', 'lobbied_on',
  'disclosed_interest', 'testified_on', 'awarded_contract', 'awarded_grant', 'owns', 'leases',
])

export type Gate = Pick<UserAccountRow, 'subscription_tier' | 'subscription_status' | 'is_staff'> | null | undefined

export function isPaid(account: Gate): boolean {
  if (!account) return false
  return (PAID_TIERS as readonly string[]).includes(account.subscription_tier) &&
    (ACTIVE_STATUSES as readonly string[]).includes(account.subscription_status)
}

export function isStaff(account: Gate): boolean {
  return !!account?.is_staff
}

export function canAccessGatedContent(account: Gate): boolean {
  return isPaid(account) || isStaff(account)
}

export function canAccessApi(account: Gate): boolean {
  if (isStaff(account)) return true
  return isPaid(account) && (account!.subscription_tier === 'professional' || account!.subscription_tier === 'institutional')
}

export function canExportCsv(account: Gate): boolean {
  return canAccessApi(account)
}

export function canReadDocType(docType: string, account: Gate): boolean {
  return !PAID_DOC_TYPES.has(docType) || canAccessGatedContent(account)
}

export function canReadEdgeType(edgeType: string, account: Gate): boolean {
  return !PAID_EDGE_TYPES.has(edgeType) || canAccessGatedContent(account)
}
