import type { Cadence } from '@/lib/import/source-registry'

/** Hours after which a source on the given cadence counts as overdue (includes slack). */
export const CADENCE_HOURS: Record<Cadence, number | null> = {
  hourly: 2,
  daily: 26,
  weekly: 24 * 8,
  monthly: 24 * 32,
  quarterly: 24 * 95,
  annual: 24 * 370,
  on_demand: null,
}

export function isOverdue(cadence: Cadence, lastRunAt: string | null | undefined): boolean {
  const limit = CADENCE_HOURS[cadence]
  if (limit === null) return false
  if (!lastRunAt) return true
  const t = new Date(lastRunAt).getTime()
  if (Number.isNaN(t)) return true
  return (Date.now() - t) / (1000 * 60 * 60) > limit
}
