import type { Db, EntityKind } from '../types'
import { normalize } from '@/lib/entity-match'

export interface SearchFilters {
  kind?: EntityKind | EntityKind[]
  entityTypes?: string[]   // person.attributes.entity_types overlap
  orgTypes?: string[]      // org.attributes.org_type in
  island?: string
  sector?: string
  status?: string
  limit?: number
  offset?: number
  /** Optional query embedding (1024-d) for hybrid ranking against document/summary embeddings. */
  embedding?: number[]
}

export interface SearchHit {
  id: string
  kind: EntityKind
  name: string
  slug: string | null
  subtitle: string | null
  badges: string[]
  island: string | null
  status: string | null
  score: number
}

/**
 * Entity search: trigram similarity over name and aliases (plus ILIKE containment) with optional
 * embedding boost from summaries linked to the entity. Returns hits ordered by score.
 */
export async function searchEntities(db: Db, query: string, filters: SearchFilters = {}): Promise<{ results: SearchHit[]; total: number }> {
  const q = query.trim()
  if (!q) return { results: [], total: 0 }
  const probe = normalize(q)
  const params: unknown[] = [q, probe]
  const where: string[] = ['e.merged_into_id is null']
  where.push(`(e.name ilike '%' || $1 || '%' or similarity(lower(e.name), $2) >= 0.3
              or exists (select 1 from unnest(e.aliases) a where a ilike '%' || $1 || '%' or similarity(lower(a), $2) >= 0.3))`)
  const kinds = filters.kind ? (Array.isArray(filters.kind) ? filters.kind : [filters.kind]) : null
  if (kinds?.length) { params.push(kinds); where.push(`e.kind = any($${params.length})`) }
  if (filters.entityTypes?.length) { params.push(filters.entityTypes); where.push(`(e.attributes -> 'entity_types') ?| $${params.length}::text[]`) }
  if (filters.orgTypes?.length) { params.push(filters.orgTypes); where.push(`e.attributes ->> 'org_type' = any($${params.length})`) }
  if (filters.island) { params.push(filters.island); where.push(`e.attributes ->> 'island' = $${params.length}`) }
  if (filters.sector) { params.push(filters.sector); where.push(`e.attributes ->> 'sector' = $${params.length}`) }
  if (filters.status) { params.push(filters.status); where.push(`e.attributes ->> 'status' = $${params.length}`) }

  let embeddingScore = '0'
  if (filters.embedding?.length === 1024) {
    params.push(`[${filters.embedding.join(',')}]`)
    embeddingScore = `coalesce((select max(1 - (s.embedding <=> $${params.length}::vector)) from summary s where s.entity_id = e.id and s.status = 'published' and s.embedding is not null), 0)`
  }

  const sqlWhere = where.join(' and ')
  const total = await db.one<{ n: string }>(`select count(*)::text n from entity e where ${sqlWhere}`, params)
  params.push(Math.min(filters.limit ?? 20, 100), filters.offset ?? 0)
  const rows = await db.many<{
    id: string; kind: EntityKind; name: string; attributes: Record<string, unknown>; score: number
  }>(
    `select e.id, e.kind, e.name, e.attributes,
            greatest(similarity(lower(e.name), $2),
                     coalesce((select max(similarity(lower(a), $2)) from unnest(e.aliases) a), 0),
                     case when e.name ilike '%' || $1 || '%' then 0.6 else 0 end)
              + 0.3 * ${embeddingScore}
              + case when coalesce((e.attributes ->> 'is_featured')::boolean, false) then 0.05 else 0 end as score
       from entity e where ${sqlWhere}
       order by score desc, e.name asc
       limit $${params.length - 1} offset $${params.length}`,
    params)

  return {
    total: Number(total?.n ?? 0),
    results: rows.map(r => toHit(r)),
  }
}

function toHit(r: { id: string; kind: EntityKind; name: string; attributes: Record<string, unknown>; score: number }): SearchHit {
  const a = r.attributes ?? {}
  const str = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : null)
  const subtitle = r.kind === 'person'
    ? [str('office_held'), str('party'), str('district')].filter(Boolean).join(' · ')
    : r.kind === 'org'
      ? [str('org_type')?.replace(/_/g, ' '), str('sector')?.replace(/_/g, ' ')].filter(Boolean).join(' · ')
      : r.kind === 'bill'
        ? [str('measure_number'), str('session')].filter(Boolean).join(' · ')
        : str('description')
  const badges = r.kind === 'person'
    ? (Array.isArray(a.entity_types) ? (a.entity_types as string[]) : [])
    : r.kind === 'org' ? [str('org_type')].filter((x): x is string => !!x) : [r.kind]
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    slug: str('slug'),
    subtitle: subtitle || null,
    badges,
    island: str('island'),
    status: str('status'),
    score: Number(r.score),
  }
}
