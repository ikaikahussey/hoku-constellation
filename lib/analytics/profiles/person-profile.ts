import type { Db, AlertRow, EntityRow, InfluenceScoreRow } from '@/lib/db/types'
import { getEdges } from '@/lib/db/queries/edges'
import { getEntity } from '@/lib/db/queries/entities'
import type { PersonProfile, ScoreBreakdown, EdgeView } from '../types'

export function scoreFromRow(row: InfluenceScoreRow | null): ScoreBreakdown | null {
  if (!row) return null
  return {
    composite: Number(row.composite_score),
    political_money: Number(row.political_money_score),
    institutional_position: Number(row.institutional_position_score),
    lobbying: Number(row.lobbying_score),
    economic_footprint: Number(row.economic_footprint_score),
    network_centrality: Number(row.network_centrality_score),
    public_visibility: Number(row.public_visibility_score),
  }
}

/**
 * Complete dossier for one person entity, assembled in parallel over canonical edges.
 * All queries go through the provided `Db` — the caller controls the access context.
 */
export async function getPersonProfile(db: Db, entityId: string): Promise<PersonProfile> {
  const entity = await getEntity(db, entityId)
  const id = entity?.id ?? entityId
  const [roles, donationsGiven, donationsReceived, lobbying, testimony, boards, property, disclosure, scoreRow, connections, alerts] =
    await Promise.all([
      getEdges(db, id, { types: ['employed_by', 'officer_of', 'director_of', 'member_of'], direction: 'out', limit: 200 }),
      getEdges(db, id, { types: ['contributed_to'], direction: 'out', matchStatus: ['matched', 'review'], limit: 500 }),
      getEdges(db, id, { types: ['contributed_to'], direction: 'in', matchStatus: ['matched', 'review'], limit: 500 }),
      getEdges(db, id, { types: ['lobbied_for', 'lobbied_on'], direction: 'out', limit: 200 }),
      getEdges(db, id, { types: ['testified_on'], direction: 'out', limit: 200 }),
      getEdges(db, id, { types: ['appointed_to', 'confirmed_by'], direction: 'out', limit: 100 }),
      getEdges(db, id, { types: ['owns', 'leases'], direction: 'out', limit: 200 }),
      getEdges(db, id, { types: ['disclosed_interest'], direction: 'out', limit: 50 }),
      db.one<InfluenceScoreRow>(`select * from ax_influence_score where entity_id = $1`, [id]),
      db.many<Record<string, unknown>>(
        `select r.*, s.name as source_name, t.name as target_name from ax_relationship_edge r
           join entity s on s.id = r.source_entity_id join entity t on t.id = r.target_entity_id
          where r.source_entity_id = $1 or r.target_entity_id = $1 order by r.weight desc limit 10`, [id]),
      db.many<AlertRow>(`select * from ax_alert where entity_id = $1 order by created_at desc limit 10`, [id]),
    ])

  // Contracts via orgs where this person holds an officer/director role
  const orgIds = roles.filter(r => ['officer_of', 'director_of'].includes(r.type) && r.to_id).map(r => r.to_id as string)
  let contracts: EdgeView[] = []
  if (orgIds.length) {
    contracts = await db.many<EdgeView>(
      `select e.*, f.name from_name, f.kind from_kind, f.attributes ->> 'slug' from_slug, t.name to_name, t.kind to_kind, t.attributes ->> 'slug' to_slug,
              d.source doc_source, d.doc_type, d.title doc_title, d.url doc_url, d.doc_date
         from edge e left join entity f on f.id = e.from_id left join entity t on t.id = e.to_id join document d on d.id = e.document_id
        where e.type in ('awarded_contract','awarded_grant') and e.to_id = any($1::uuid[]) order by e.amount desc nulls last limit 200`, [orgIds])
  }

  return {
    entity, person: entity as EntityRow | null,
    roles, donationsGiven, donationsReceived, lobbying, testimony, boards, property, disclosure, contracts,
    score: scoreFromRow(scoreRow), connections, alerts,
  }
}
