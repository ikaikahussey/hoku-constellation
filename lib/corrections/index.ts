/**
 * Corrections (E8): "Report an error" on every entity, bill, and document page writes to
 * app.correction; staff work the queue in /admin/corrections. Target: acknowledged within one
 * business day (Hawaiʻi time).
 */
import type { Db } from '@/lib/db/types'

export interface CorrectionInput {
  userId: string | null; teamId?: string | null; email?: string | null
  entityId?: string | null; edgeId?: string | null; documentId?: string | null; pageUrl?: string | null; description: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const id = (v?: string | null) => (v && UUID.test(v) ? v : null)

export async function submitCorrection(db: Db, c: CorrectionInput): Promise<string> {
  const description = c.description.trim()
  if (description.length < 5) throw new Error('Describe the error in a sentence or two')
  if (description.length > 5000) throw new Error('Keep the description under 5,000 characters')
  const entityId = id(c.entityId), edgeId = id(c.edgeId), documentId = id(c.documentId)
  if (!entityId && !edgeId && !documentId && !c.pageUrl) throw new Error('Say which page or record is wrong')
  const r = await db.one<{ id: string }>(
    `insert into app.correction(user_id, team_id, reporter_email, entity_id, edge_id, document_id, page_url, description)
     values ($1, $2, $3, (select id from entity where id = $4), (select id from edge where id = $5), (select id from document where id = $6), $7, $8) returning id`,
    [c.userId, c.teamId ?? null, c.email?.slice(0, 320) ?? null, entityId, edgeId, documentId, c.pageUrl?.slice(0, 500) ?? null, description])
  return r!.id
}

/** Add one business day (Mon–Fri, HST) to a timestamp. */
export function oneBusinessDayAfter(d: Date): Date {
  const out = new Date(d.getTime() + 864e5)
  const day = () => new Date(out.getTime() - 36e6).getUTCDay()
  while (day() === 0 || day() === 6) out.setTime(out.getTime() + 864e5)
  return out
}

export interface CorrectionRow {
  id: string; status: string; description: string; resolution: string | null; created_at: string; acknowledged_at: string | null; resolved_at: string | null
  reporter_email: string | null; entity_id: string | null; entity_name: string | null; entity_kind: string | null; slug: string | null
  document_id: string | null; document_title: string | null; edge_id: string | null; page_url: string | null; overdue: boolean
}

export async function listCorrections(db: Db, status: 'open' | 'all' = 'open', now = new Date()): Promise<CorrectionRow[]> {
  const rows = await db.many<Omit<CorrectionRow, 'overdue'>>(
    `select c.id, c.status, c.description, c.resolution, c.created_at::text, c.acknowledged_at::text, c.resolved_at::text, c.reporter_email,
            c.entity_id, e.name entity_name, e.kind entity_kind, e.attributes->>'slug' slug, c.document_id, d.title document_title, c.edge_id, c.page_url
       from app.correction c left join entity e on e.id = c.entity_id left join document d on d.id = c.document_id
      where ($1 = 'all' or c.status in ('open','acknowledged')) order by c.created_at`, [status])
  return rows.map(r => ({ ...r, overdue: r.status === 'open' && oneBusinessDayAfter(new Date(r.created_at)) < now }))
}

export async function updateCorrection(db: Db, id: string, staffUserId: string, action: 'acknowledge' | 'resolve' | 'reject', resolution?: string) {
  if (action === 'acknowledge') {
    await db.query(`update app.correction set status = 'acknowledged', acknowledged_at = coalesce(acknowledged_at, now()) where id = $1 and status = 'open'`, [id])
  } else {
    if (!resolution?.trim()) throw new Error('Explain the resolution')
    await db.query(`update app.correction set status = $2, resolution = $3, resolved_at = now(), resolved_by = $4, acknowledged_at = coalesce(acknowledged_at, now()) where id = $1`,
      [id, action === 'resolve' ? 'resolved' : 'rejected', resolution.trim().slice(0, 5000), staffUserId])
  }
}
