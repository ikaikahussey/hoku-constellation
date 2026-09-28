/**
 * CKAN DataStore client (opendata.hawaii.gov and other CKAN portals).
 */
import { fetchJson } from '../http'

export interface CkanResource { id: string; name: string; format: string; datastore_active?: boolean; last_modified?: string | null; url?: string }
export interface CkanPackage { id: string; name: string; title: string; organization?: { title: string }; resources: CkanResource[]; metadata_modified?: string }

export interface DatastoreSearchResult<T = Record<string, unknown>> {
  total: number
  records: T[]
  fields: Array<{ id: string; type: string }>
  _links?: { next?: string }
}

export class CkanClient {
  constructor(private base: string, private appToken?: string) {}

  private url(action: string, params: Record<string, string | number | undefined>): string {
    const u = new URL(`${this.base.replace(/\/$/, '')}/api/3/action/${action}`)
    for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, String(v))
    return u.toString()
  }

  private headers(): Record<string, string> {
    return this.appToken ? { authorization: this.appToken } : {}
  }

  async packageSearch(q: string, rows = 50): Promise<CkanPackage[]> {
    const res = await fetchJson<{ success: boolean; result: { results: CkanPackage[] } }>(this.url('package_search', { q, rows }), { headers: this.headers() })
    if (!res.success) throw new Error(`CKAN package_search failed for "${q}"`)
    return res.result.results
  }

  async packageShow(idOrName: string): Promise<CkanPackage> {
    const res = await fetchJson<{ success: boolean; result: CkanPackage }>(this.url('package_show', { id: idOrName }), { headers: this.headers() })
    if (!res.success) throw new Error(`CKAN package_show failed for ${idOrName}`)
    return res.result
  }

  async datastoreSearch<T = Record<string, unknown>>(resourceId: string, opts: { limit?: number; offset?: number; filters?: Record<string, unknown>; sort?: string; q?: string } = {}): Promise<DatastoreSearchResult<T>> {
    const res = await fetchJson<{ success: boolean; result: DatastoreSearchResult<T>; error?: unknown }>(
      this.url('datastore_search', {
        resource_id: resourceId, limit: opts.limit ?? 1000, offset: opts.offset ?? 0, sort: opts.sort,
        filters: opts.filters ? JSON.stringify(opts.filters) : undefined, q: opts.q,
      }), { headers: this.headers() })
    if (!res.success) throw new Error(`CKAN datastore_search failed for ${resourceId}: ${JSON.stringify(res.error)}`)
    return res.result
  }

  async datastoreCount(resourceId: string, filters?: Record<string, unknown>): Promise<number> {
    const r = await this.datastoreSearch(resourceId, { limit: 0, filters })
    return r.total
  }

  /** Iterate all records of a resource in pages, starting at `offset`. */
  async *iterate<T = Record<string, unknown>>(resourceId: string, opts: { pageSize?: number; offset?: number; filters?: Record<string, unknown>; sort?: string } = {}): AsyncGenerator<{ records: T[]; offset: number; total: number }> {
    let offset = opts.offset ?? 0
    const pageSize = opts.pageSize ?? 1000
    for (;;) {
      const page = await this.datastoreSearch<T>(resourceId, { limit: pageSize, offset, filters: opts.filters, sort: opts.sort ?? '_id asc' })
      if (!page.records.length) return
      yield { records: page.records, offset, total: page.total }
      offset += page.records.length
      if (page.records.length < pageSize || offset >= page.total) return
    }
  }
}

export const HAWAII_OPEN_DATA = 'https://opendata.hawaii.gov'
