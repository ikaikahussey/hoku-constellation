/**
 * Postgres wire-protocol server backed by PGlite for end-to-end tests: applies db/migrations, seeds a
 * small public dataset, listens on E2E_PG_PORT (default 54329). Started by playwright.config.ts.
 */
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { readMigrations } from '../helpers/pglite'

export const SEED_SQL = `
insert into entity (id, kind, name, aliases, identifiers, attributes) values
  ('00000000-0000-4000-8000-000000000001', 'person', 'Josh Green', '{"Green, Josh"}', '{"csc_reg_no":"CC10529"}', '{"slug":"josh-green","entity_types":["person","legislator"],"office_held":"Governor","island":"Oahu","status":"active"}'),
  ('00000000-0000-4000-8000-000000000002', 'org', 'Hawaiian Electric Industries', '{"HEI"}', '{"sec_cik":"0000354707"}', '{"slug":"hawaiian-electric-industries","org_type":"corporation","sector":"Energy","island":"Oahu","status":"active"}'),
  ('00000000-0000-4000-8000-000000000003', 'person', 'Scott Seu', '{}', '{}', '{"slug":"scott-seu","entity_types":["person","executive"],"status":"active"}'),
  ('00000000-0000-4000-8000-000000000004', 'bill', 'SB1234 (2026)', '{}', '{"measure":"2026:SB1234"}', '{"slug":"sb1234-2026","measure_number":"SB1234","session":"2026","title":"RELATING TO ENERGY.","current_status":"Referred to EET, CPN."}')
on conflict do nothing;
insert into document (id, source, source_record_id, doc_type, title, doc_date, checksum, raw) values
  ('00000000-0000-4000-8000-00000000000a', 'sec_edgar', 'seed:1', 'sec_filing', 'HEI DEF 14A', '2026-03-20', repeat('a', 64), '{}'),
  ('00000000-0000-4000-8000-00000000000b', 'csc', 'seed:2', 'contribution', 'HEI PAC → Green', '2022-03-15', repeat('b', 64), '{}'),
  ('00000000-0000-4000-8000-00000000000c', 'capitol_measures', 'seed:3', 'measure', 'SB1234', '2026-01-17', repeat('c', 64), '{}')
on conflict do nothing;
insert into edge (document_id, type, from_id, to_id, from_name_raw, to_name_raw, role, amount, start_date, match_status, match_confidence) values
  ('00000000-0000-4000-8000-00000000000a', 'officer_of', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', 'Scott Seu', 'Hawaiian Electric Industries', 'President and CEO', null, '2022-01-01', 'matched', 1),
  ('00000000-0000-4000-8000-00000000000b', 'contributed_to', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Hawaiian Electric Industries PAC', 'Green, Josh', 'Noncandidate Committee', 2000, '2022-03-15', 'matched', 1),
  ('00000000-0000-4000-8000-00000000000c', 'sponsored', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004', 'GREEN', 'SB1234 (2026)', 'introducer', null, '2026-01-17', 'matched', 1)
on conflict do nothing;
`

async function main() {
  const db = await PGlite.create({ extensions: { vector, pg_trgm } })
  await db.exec(readMigrations())
  await db.exec(SEED_SQL)
  const port = Number(process.env.E2E_PG_PORT ?? 54329)
  // The app pool uses one connection, but a recycled connection can reconnect before the old handler
  // is released; allow a few so that race is not rejected as "Too many connections".
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', inspect: process.env.E2E_PG_INSPECT === '1', maxConnections: 8 })
  await server.start()
  console.log(`[e2e-db] PGlite listening on 127.0.0.1:${port}`)
  const stop = async () => { await server.stop(); await db.close(); process.exit(0) }
  process.on('SIGINT', stop); process.on('SIGTERM', stop)
}

main().catch(e => { console.error(e); process.exit(1) })
