/**
 * Row sources for CSV export of list and table views (E7): my bills, votes, contributions,
 * testimony, entity search results, and the document browser. Each returns plain rows plus the
 * column order; lib/export/csv.ts serializes them. Every row carries its source document id.
 */
import type { Db } from '@/lib/db/types'
import { searchEntities } from '@/lib/db/queries/search'
import { listDocuments } from '@/lib/db/queries/documents'
import { classifyStatus } from '@/lib/alerts/events'
import type { Column } from './csv'

export const EXPORT_KINDS = ['bills', 'votes', 'contributions', 'testimony', 'search', 'documents'] as const
export type ExportKind = (typeof EXPORT_KINDS)[number]

type Row = Record<string, unknown>
export interface ExportResult { rows: Row[]; columns: Array<Column<Row>>; label: string }

const cols = (...keys: string[]): Array<Column<Row>> => keys.map(k => ({ key: k, header: k }))
const UUID = /^[0-9a-f-]{36}$/i
const MAX = 50_000

export async function exportRows(db: Db, kind: ExportKind, params: URLSearchParams, userId: string): Promise<ExportResult> {
  switch (kind) {
    case 'bills': {
      const rows = await db.many<Row>(
        `select e.attributes->>'measure_number' measure, e.attributes->>'session' session, e.name, e.attributes->>'title' title,
                e.attributes->>'current_status' current_status, e.attributes->>'current_referral' current_referral,
                string_agg(distinct w.name, '; ') watchlists, string_agg(distinct i.position, '; ') position, e.id entity_id,
                (select d.id from document d where d.source = 'capitol_measures' and d.source_record_id = e.identifiers->>'measure') source_document_id
           from app.team_member m join app.watchlist w on w.team_id = m.team_id join app.watchlist_item i on i.watchlist_id = w.id join entity e on e.id = i.entity_id
          where m.user_id = $1 and m.joined_at is not null and m.removed_at is null and e.kind = 'bill'
          group by e.id order by e.name`, [userId])
      for (const r of rows) {
        const c = classifyStatus(String(r.current_status ?? ''))
        r.next_hearing = c.hearingAt && c.type !== 'bill.hearing_canceled' ? c.hearingAt.toISOString() : ''
        r.testimony_due = c.hearingAt && c.type !== 'bill.hearing_canceled' ? new Date(c.hearingAt.getTime() - 864e5).toISOString() : ''
      }
      const sort = params.get('sort') ?? 'measure'
      rows.sort((a, b) => String(a[sort] ?? '').localeCompare(String(b[sort] ?? '')))
      return { rows, label: 'my-bills', columns: cols('measure', 'session', 'title', 'current_status', 'current_referral', 'next_hearing', 'testimony_due', 'position', 'watchlists', 'entity_id', 'source_document_id') }
    }
    case 'votes':
    case 'testimony': {
      const bill = params.get('bill') ?? ''
      if (!UUID.test(bill)) throw new Error('bill parameter required')
      const type = kind === 'votes' ? 'voted_on' : 'testified_on'
      const rows = await db.many<Row>(
        `select coalesce(p.name, e.from_name_raw) name, p.kind, e.role ${kind === 'votes' ? 'vote' : 'position'}, e.attributes->>'committee' committee,
                coalesce(e.start_date, d.doc_date)::text date, e.attributes->>'organization' organization, d.title source_title, d.url source_url, e.document_id source_document_id
           from edge e join document d on d.id = e.document_id left join entity p on p.id = e.from_id
          where e.type = $2 and e.to_id = $1 order by 5 nulls last, 1 limit ${MAX}`, [bill, type])
      return { rows, label: `${kind}-${bill.slice(0, 8)}`, columns: cols('date', 'committee', 'name', kind === 'votes' ? 'vote' : 'position', ...(kind === 'testimony' ? ['organization'] : []), 'source_title', 'source_url', 'source_document_id') }
    }
    case 'contributions': {
      const entity = params.get('entity') ?? ''
      if (!UUID.test(entity)) throw new Error('entity parameter required')
      const dir = params.get('direction') === 'out' ? 'out' : params.get('direction') === 'in' ? 'in' : 'both'
      const rows = await db.many<Row>(
        `select coalesce(e.start_date, d.doc_date)::text date, coalesce(f.name, e.from_name_raw) contributor, coalesce(t.name, e.to_name_raw) recipient,
                e.amount::text amount, e.attributes->>'election_period' election_period, d.source, d.title source_title, e.document_id source_document_id
           from edge e join document d on d.id = e.document_id left join entity f on f.id = e.from_id left join entity t on t.id = e.to_id
          where e.type = 'contributed_to' and ((${dir !== 'out'} and e.to_id = $1) or (${dir !== 'in'} and e.from_id = $1))
          order by 1 desc nulls last limit ${MAX}`, [entity])
      return { rows, label: `contributions-${entity.slice(0, 8)}`, columns: cols('date', 'contributor', 'recipient', 'amount', 'election_period', 'source', 'source_title', 'source_document_id') }
    }
    case 'search': {
      const { results } = await searchEntities(db, params.get('q') ?? '', { limit: 1000 })
      return { rows: results.map(r => ({ ...r, badges: r.badges.join('; ') })), label: 'search', columns: cols('kind', 'name', 'subtitle', 'badges', 'island', 'status', 'score', 'id') }
    }
    case 'documents': {
      const { rows } = await listDocuments(db, {
        q: params.get('q') ?? undefined, sources: params.getAll('source'), docTypes: params.getAll('type'),
        from: params.get('from') ?? undefined, to: params.get('to') ?? undefined, limit: 10_000,
      })
      return { rows: rows as unknown as Row[], label: 'documents', columns: cols('doc_date', 'source', 'doc_type', 'title', 'source_record_id', 'url', 'id') }
    }
  }
}
