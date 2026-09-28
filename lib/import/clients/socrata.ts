/**
 * Socrata SODA 2.x client (data.honolulu.gov, hicscdata.hawaii.gov). Uses SOCRATA_APP_TOKEN when present.
 */
import { fetchJson } from '../http'

export class SocrataClient {
  constructor(private domain: string, private appToken = process.env.SOCRATA_APP_TOKEN) {}

  private headers(): Record<string, string> {
    return this.appToken ? { 'x-app-token': this.appToken } : {}
  }

  url(datasetId: string, params: Record<string, string | number | undefined>): string {
    const u = new URL(`https://${this.domain}/resource/${datasetId}.json`)
    for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, String(v))
    return u.toString()
  }

  async query<T = Record<string, unknown>>(datasetId: string, opts: { limit?: number; offset?: number; where?: string; order?: string; select?: string } = {}): Promise<T[]> {
    return fetchJson<T[]>(this.url(datasetId, {
      $limit: opts.limit ?? 1000, $offset: opts.offset ?? 0, $where: opts.where, $order: opts.order ?? ':id', $select: opts.select,
    }), { headers: this.headers() })
  }

  async count(datasetId: string, where?: string): Promise<number> {
    const rows = await fetchJson<Array<{ count: string }>>(this.url(datasetId, { $select: 'count(*) as count', $where: where }), { headers: this.headers() })
    return Number(rows[0]?.count ?? 0)
  }

  async *iterate<T = Record<string, unknown>>(datasetId: string, opts: { pageSize?: number; offset?: number; where?: string; order?: string } = {}): AsyncGenerator<{ records: T[]; offset: number }> {
    let offset = opts.offset ?? 0
    const pageSize = opts.pageSize ?? 1000
    for (;;) {
      const records = await this.query<T>(datasetId, { limit: pageSize, offset, where: opts.where, order: opts.order })
      if (!records.length) return
      yield { records, offset }
      offset += records.length
      if (records.length < pageSize) return
    }
  }

  /** Dataset metadata (columns, row count, last update). */
  async metadata(datasetId: string): Promise<Record<string, unknown>> {
    return fetchJson(`https://${this.domain}/api/views/${datasetId}.json`, { headers: this.headers() })
  }
}
