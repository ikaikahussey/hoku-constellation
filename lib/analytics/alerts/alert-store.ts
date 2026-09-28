import type { Db, AlertRow } from '@/lib/db/types'

export async function listAlerts(db: Db, opts: { entityId?: string; limit?: number; unacknowledgedOnly?: boolean } = {}): Promise<AlertRow[]> {
  const params: unknown[] = []
  const where: string[] = []
  if (opts.entityId) { params.push(opts.entityId); where.push(`entity_id = $${params.length}`) }
  if (opts.unacknowledgedOnly) where.push('acknowledged = false')
  params.push(Math.min(opts.limit ?? 50, 500))
  return db.many<AlertRow>(
    `select * from ax_alert ${where.length ? 'where ' + where.join(' and ') : ''} order by created_at desc limit $${params.length}`, params)
}

export async function acknowledgeAlert(db: Db, alertId: string): Promise<void> {
  await db.query(`update ax_alert set acknowledged = true where id = $1`, [alertId])
}
