import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiRequest, paginationParams, csvResponse, edgeToApi } from '../_lib/auth'

export async function GET(request: NextRequest) {
  const { error, db } = await authenticateApiRequest()
  if (error) return error
  const sp = request.nextUrl.searchParams
  const { limit, offset } = paginationParams(sp)
  const params: unknown[] = []
  const where = [`e.type = 'contributed_to'`]
  const add = (clause: string, v: unknown) => { params.push(v); where.push(clause.replace('?', `$${params.length}`)) }
  if (sp.get('donor')) add(`(e.from_name_raw ilike ? or f.name ilike ?)`.replace('?', `$${params.length + 1}`).replace('?', `$${params.length + 1}`), `%${sp.get('donor')}%`)
  if (sp.get('recipient')) add(`(e.to_name_raw ilike ? or t.name ilike ?)`.replace('?', `$${params.length + 1}`).replace('?', `$${params.length + 1}`), `%${sp.get('recipient')}%`)
  if (sp.get('min_amount')) add(`e.amount >= ?`, Number(sp.get('min_amount')))
  if (sp.get('max_amount')) add(`e.amount <= ?`, Number(sp.get('max_amount')))
  if (sp.get('from')) add(`e.start_date >= ?`, sp.get('from'))
  if (sp.get('to')) add(`e.start_date <= ?`, sp.get('to'))
  params.push(limit, offset)
  const rows = await db.many(
    `select e.*, f.name from_name, f.kind from_kind, f.attributes ->> 'slug' from_slug, t.name to_name, t.kind to_kind, t.attributes ->> 'slug' to_slug,
            d.source doc_source, d.doc_type, d.title doc_title, d.url doc_url, d.doc_date
       from edge e left join entity f on f.id = e.from_id left join entity t on t.id = e.to_id join document d on d.id = e.document_id
      where ${where.join(' and ')} order by e.start_date desc nulls last, e.id limit $${params.length - 1} offset $${params.length}`, params)
  const data = rows.map(edgeToApi)
  if (sp.get('format') === 'csv') return csvResponse(data.map(r => ({ id: r.id, date: r.start_date, donor: r.from.name, recipient: r.to.name, amount: r.amount, source: r.document.source })), 'contributions.csv')
  return NextResponse.json({ data, limit, offset })
}
