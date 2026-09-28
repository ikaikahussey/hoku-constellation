import type { Db } from '../types'
import type { EdgeWithEnds } from './edges'

export interface MoneyFlow {
  bill: { id: string; name: string; attributes: Record<string, unknown> } | null
  testimony: EdgeWithEnds[]
  byPosition: { support: EdgeWithEnds[]; oppose: EdgeWithEnds[]; comment: EdgeWithEnds[] }
  lobbying: EdgeWithEnds[]
  officers: EdgeWithEnds[]
  contributions: EdgeWithEnds[]
  sponsors: EdgeWithEnds[]
  votes: EdgeWithEnds[]
}

const EDGE_SELECT = `
  select e.*, f.name as from_name, f.kind as from_kind, f.attributes ->> 'slug' as from_slug,
         t.name as to_name, t.kind as to_kind, t.attributes ->> 'slug' as to_slug,
         d.source as doc_source, d.doc_type as doc_type, d.title as doc_title, d.url as doc_url, d.doc_date as doc_date
    from edge e left join entity f on f.id = e.from_id left join entity t on t.id = e.to_id join document d on d.id = e.document_id`

/**
 * Bill landscape: testimony → the orgs behind testifiers → lobbyists for those orgs → officers of
 * those orgs → contributions from those officers/orgs to legislators who sponsored or voted on the bill.
 */
export async function getMoneyFlow(db: Db, billEntityId: string): Promise<MoneyFlow> {
  const bill = await db.one<{ id: string; name: string; attributes: Record<string, unknown> }>(
    `select id, name, attributes from entity where id = $1 and kind = 'bill'`, [billEntityId])

  const [testimony, sponsors, votes] = await Promise.all([
    db.many<EdgeWithEnds>(`${EDGE_SELECT} where e.type = 'testified_on' and e.to_id = $1 order by e.start_date desc nulls last`, [billEntityId]),
    db.many<EdgeWithEnds>(`${EDGE_SELECT} where e.type = 'sponsored' and e.to_id = $1`, [billEntityId]),
    db.many<EdgeWithEnds>(`${EDGE_SELECT} where e.type = 'voted_on' and e.to_id = $1`, [billEntityId]),
  ])

  const orgIds = [...new Set(testimony.filter(t => t.from_kind === 'org' && t.from_id).map(t => t.from_id as string))]
  const legislatorIds = [...new Set([...sponsors, ...votes].map(e => e.from_id).filter((x): x is string => !!x))]

  let lobbying: EdgeWithEnds[] = []
  let officers: EdgeWithEnds[] = []
  let contributions: EdgeWithEnds[] = []
  if (orgIds.length) {
    ;[lobbying, officers] = await Promise.all([
      db.many<EdgeWithEnds>(`${EDGE_SELECT} where e.type = 'lobbied_for' and e.to_id = any($1::uuid[])`, [orgIds]),
      db.many<EdgeWithEnds>(`${EDGE_SELECT} where e.type in ('officer_of','director_of') and e.to_id = any($1::uuid[])`, [orgIds]),
    ])
    const donorIds = [...new Set([...orgIds, ...officers.map(o => o.from_id).filter((x): x is string => !!x)])]
    contributions = await db.many<EdgeWithEnds>(
      `${EDGE_SELECT} where e.type = 'contributed_to' and e.from_id = any($1::uuid[])
         and ($2::uuid[] = '{}' or e.to_id = any($2::uuid[]))
       order by e.amount desc nulls last limit 500`,
      [donorIds, legislatorIds])
  }

  const pos = (p: string) => testimony.filter(t => (t.role ?? '').toLowerCase() === p)
  return {
    bill,
    testimony,
    byPosition: { support: pos('support'), oppose: pos('oppose'), comment: pos('comment') },
    lobbying,
    officers,
    contributions,
    sponsors,
    votes,
  }
}

/** Find the bill entity for a measure number in a session (e.g. "SB1234", "2026"). */
export async function findBill(db: Db, measureNumber: string, session: string): Promise<{ id: string } | null> {
  const norm = measureNumber.replace(/\s+/g, '').toUpperCase()
  return db.one<{ id: string }>(
    `select id from entity where kind = 'bill' and upper(replace(attributes ->> 'measure_number', ' ', '')) = $1 and attributes ->> 'session' = $2 limit 1`,
    [norm, session])
}
