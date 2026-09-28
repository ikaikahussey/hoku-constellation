import type { Db, EntityRow, InfluenceScoreRow } from '@/lib/db/types'

export async function compareEntities(db: Db, entityIds: string[]) {
  const [scores, people] = await Promise.all([
    db.many<InfluenceScoreRow>(`select * from ax_influence_score where entity_id = any($1::uuid[])`, [entityIds]),
    db.many<Pick<EntityRow, 'id' | 'name' | 'attributes'>>(`select id, name, attributes from entity where id = any($1::uuid[])`, [entityIds]),
  ])
  return {
    people: people.map(p => ({ id: p.id, full_name: p.name, office_held: p.attributes?.office_held ?? null })),
    scores,
  }
}
