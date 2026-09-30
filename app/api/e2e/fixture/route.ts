/**
 * Offline e2e only: simulates an upstream change the way an importer would record it. 404 unless test
 * auth is enabled (localhost + E2E_TEST_AUTH_SECRET, never on Vercel).
 *
 *   POST { action: 'bill_status', measure: 'SB1234', session: '2026', status: '…' }
 *   POST { action: 'priority_review', user_id, name, alias } → makes the user staff, adds a priority person and
 *        two review edges (a large unrelated one and a small one naming the person); returns { entity_id }
 *   POST { action: 'priority_cleanup', entity_id } → removes what priority_review added, so later specs see the seed data only
 */
import { NextResponse, type NextRequest } from 'next/server'
import { testAuthEnabled } from '@/lib/auth'
import { getServiceDb } from '@/lib/db/service'
import { upsertDocument } from '@/lib/import/pipeline'

export async function POST(request: NextRequest) {
  if (!testAuthEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const b = await request.json() as { action?: string; measure?: string; session?: string; status?: string; date?: string; user_id?: string; name?: string; alias?: string; entity_id?: string }
  if (b.action === 'priority_cleanup' && b.entity_id) {
    const db = await getServiceDb()
    const slug = (await db.one<{ slug: string }>(`select attributes ->> 'slug' slug from entity where id = $1`, [b.entity_id]))?.slug
    if (slug) {
      await db.query(`delete from edge where document_id in (select id from document where source = 'e2e' and source_record_id = $1)`, [`priority:${slug}`])
      await db.query(`delete from document where source = 'e2e' and source_record_id = $1`, [`priority:${slug}`])
    }
    await db.query(`delete from entity where id = $1`, [b.entity_id])
    return NextResponse.json({ ok: true })
  }
  if (b.action === 'priority_review' && b.user_id && b.name) {
    const db = await getServiceDb()
    await db.query(`insert into user_account(user_id, is_staff) values ($1, true) on conflict (user_id) do update set is_staff = true`, [b.user_id])
    const slug = b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const e = await db.one<{ id: string }>(
      `insert into entity(kind, name, aliases, attributes) values ('person', $1, $2, jsonb_build_object('is_priority', true, 'slug', $3::text, 'status', 'active')) returning id`,
      [b.name, b.alias ? [b.alias] : [], slug])
    const doc = await upsertDocument(db, { source: 'e2e', source_record_id: `priority:${slug}`, doc_type: 'contribution', title: 'e2e priority fixture', raw: { slug } })
    const [first, ...rest] = (b.alias ?? b.name).split(' ')
    await db.query(`insert into edge(document_id, type, from_name_raw, to_name_raw, amount, match_status) values
      ($1, 'contributed_to', 'E2E Large Donor Group', 'E2E Committee', 999999, 'review'),
      ($1, 'contributed_to', $2, 'E2E Committee', 1, 'review') on conflict do nothing`, [doc.id, `${rest.join(' ').toUpperCase()}, ${first.toUpperCase()} K`])
    return NextResponse.json({ ok: true, entity_id: e!.id })
  }
  if (b.action !== 'bill_status' || !b.measure || !b.session || !b.status) return NextResponse.json({ error: 'unsupported fixture' }, { status: 400 })
  const db = await getServiceDb()
  const date = b.date ?? new Date().toISOString().slice(0, 10)
  const doc = await upsertDocument(db, {
    source: 'capitol_measures', source_record_id: `${b.session}:${b.measure}`, doc_type: 'measure', title: `${b.measure} (${b.session})`, doc_date: date,
    raw: { measure: b.measure, session: b.session, currentStatus: b.status, statusHistory: [{ date, chamber: 'S', text: b.status }] },
  })
  await db.query(`update entity set attributes = attributes || jsonb_build_object('current_status', $2::text) where kind = 'bill' and identifiers->>'measure' = $1`, [`${b.session}:${b.measure}`, b.status])
  return NextResponse.json({ ok: true, document_id: doc.id })
}
