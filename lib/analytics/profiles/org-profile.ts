import type { Db } from '@/lib/db/types'
import { getEdges } from '@/lib/db/queries/edges'
import { getEntity } from '@/lib/db/queries/entities'
import type { OrgProfile } from '../types'

export async function getOrgProfile(db: Db, entityId: string): Promise<OrgProfile> {
  const entity = await getEntity(db, entityId)
  const id = entity?.id ?? entityId
  const [contributions, lobbying, officers, contracts, properties, mentions] = await Promise.all([
    getEdges(db, id, { types: ['contributed_to', 'spent_with', 'loaned_to'], direction: 'both', limit: 500 }),
    getEdges(db, id, { types: ['lobbied_for', 'lobbied_on'], direction: 'in', limit: 200 }),
    getEdges(db, id, { types: ['employed_by', 'officer_of', 'director_of', 'member_of', 'appointed_to'], direction: 'in', limit: 500 }),
    getEdges(db, id, { types: ['awarded_contract', 'awarded_grant'], direction: 'both', limit: 200, orderBy: 'amount' }),
    getEdges(db, id, { types: ['owns', 'leases'], direction: 'out', limit: 200 }),
    getEdges(db, id, { types: ['mentioned_in'], direction: 'out', limit: 100 }),
  ])
  return { entity, organization: entity, contributions, lobbying, officers, contracts, properties, mentions }
}
