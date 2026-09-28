import type { Db } from '@/lib/db/types'
import type { EdgeView } from '../types'

const EDGE_SELECT = `
  select e.*, f.name from_name, f.kind from_kind, f.attributes ->> 'slug' from_slug, t.name to_name, t.kind to_kind, t.attributes ->> 'slug' to_slug,
         d.source doc_source, d.doc_type, d.title doc_title, d.url doc_url, d.doc_date
    from edge e left join entity f on f.id = e.from_id left join entity t on t.id = e.to_id join document d on d.id = e.document_id`

/** Lobbying registrations whose issues mention a topic, and testimony ingested since `since` on bills whose title mentions it. */
export async function getIssueActivity(db: Db, topic: string, since: string) {
  const [registrations, testimony] = await Promise.all([
    db.many<EdgeView>(`${EDGE_SELECT} where e.type = 'lobbied_for' and (e.attributes -> 'issues') ? $1 limit 500`, [topic]),
    db.many<EdgeView>(`${EDGE_SELECT} where e.type = 'testified_on' and d.fetched_at >= $2 and (t.name ilike '%' || $1 || '%' or t.attributes ->> 'title' ilike '%' || $1 || '%') limit 500`, [topic, since]),
  ])
  return { topic, registrations, testimony }
}
