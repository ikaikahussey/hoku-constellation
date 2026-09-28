/**
 * Loads the archived Supabase migrations into a `legacy` schema (tables only; RLS policies and
 * Supabase-specific roles are stripped) and seeds representative rows for the port tests.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { TestDb } from './pglite'

const LEGACY_DIR = join(process.cwd(), 'db', 'legacy_migrations')

export function legacySchemaSql(): string {
  const files = readdirSync(LEGACY_DIR).filter(f => f.endsWith('.sql')).sort()
  const sql = files.map(f => readFileSync(join(LEGACY_DIR, f), 'utf8')).join('\n')
  return sql
    .replace(/create( unique)? index[\s\S]*?;\s*/gi, '')
    .replace(/create policy[\s\S]*?;\s*/gi, '')
    .replace(/drop policy[^;]*;\s*/gi, '')
    .replace(/alter table \w+ enable row level security;\s*/gi, '')
    .replace(/--.*$/gm, '')
}

export async function loadLegacySchema(db: TestDb): Promise<void> {
  await db.exec(`create schema if not exists legacy; set search_path to legacy, public;`)
  await db.exec(legacySchemaSql())
  await db.exec(`set search_path to public;`)
}

export interface SeededIds {
  people: Record<string, string>
  orgs: Record<string, string>
}

/** Seeds a small but complete legacy dataset covering every legacy table the port reads. */
export async function seedLegacy(db: TestDb): Promise<SeededIds> {
  const ids: SeededIds = { people: {}, orgs: {} }
  const person = async (slug: string, name: string, extra = `'{}'`) => {
    const r = await db.one<{ id: string }>(
      `insert into legacy.person(full_name, slug, entity_types, office_held, island, visibility, is_featured) values ($1,$2,$3::text[],$4,$5,$6,$7) returning id`,
      [name, slug, extra === `'{}'` ? ['person'] : ['person', 'elected_official'], slug.startsWith('sen') ? 'State Senator' : null, 'Oʻahu', 'public', slug === 'ed-case'])
    ids.people[slug] = r!.id
    return r!.id
  }
  const org = async (slug: string, name: string, extra: Record<string, string | null> = {}) => {
    const r = await db.one<{ id: string }>(
      `insert into legacy.organization(name, slug, org_type, aliases, ein, sec_cik, fec_committee_id, visibility) values ($1,$2,$3,$4::text[],$5,$6,$7,'public') returning id`,
      [name, slug, extra.org_type ?? 'corporation', extra.aliases ? extra.aliases.split('|') : [], extra.ein ?? null, extra.sec_cik ?? null, extra.fec ?? null])
    ids.orgs[slug] = r!.id
    return r!.id
  }

  const edCase = await person('ed-case', 'Ed Case', 'x')
  const schatz = await person('brian-schatz', 'Brian Schatz', 'x')
  const donor = await person('richard-abbett', 'Richard Abbett')
  const lobbyist = await person('rachele-lamosao', 'Rachele Lamosao')
  await person('unlinked-person', 'Unlinked Person')

  const legislature = await org('hawaii-state-legislature', 'Hawaii State Legislature', { org_type: 'government' })
  const heco = await org('hawaiian-electric-industries', 'Hawaiian Electric Industries', { ein: '99-0208097', sec_cik: '0000354707', aliases: 'HEI|Hawaiian Electric' })
  const puc = await org('hawaii-public-utilities-commission', 'Hawaii Public Utilities Commission', { org_type: 'government_agency' })
  const farmBureau = await org('hawaii-farm-bureau', 'Hawaii Farm Bureau Federation', { org_type: 'nonprofit' })
  const dod = await org('department-of-defense', 'Department of Defense', { org_type: 'government_agency' })
  const hdcc = await org('hawaiian-dredging', 'Hawaiian Dredging Construction Co', { org_type: 'corporation' })

  // relationships: cover every mapped type + an unknown type
  const rels: Array<[string | null, string | null, string | null, string | null, string, string | null, boolean]> = [
    [edCase, null, null, legislature, 'former_member', 'Former State Representative', false],
    [schatz, null, null, legislature, 'leadership', 'Senate President', true],
    [schatz, null, null, heco, 'board_member', 'Director', true],
    [lobbyist, null, null, farmBureau, 'lobbyist_for', 'Registered Lobbyist', true],
    [donor, null, edCase, null, 'donor_to', 'Major donor', true],
    [null, heco, null, puc, 'affiliated_with', 'Regulated utility', true],
    [null, hdcc, null, dod, 'counsel', 'Legal representation', true],
    [edCase, null, null, legislature, 'employee', 'Legislative aide', true],
  ]
  for (const [sp, so, tp, to, type, title, cur] of rels) {
    await db.query(`insert into legacy.relationship(source_person_id, source_org_id, target_person_id, target_org_id, relationship_type, title, is_current) values ($1,$2,$3,$4,$5,$6,$7)`,
      [sp, so, tp, to, type, title, cur])
  }

  // contributions: CSC recipient-matched, FEC, unmatched, rejected, org donor
  const contribs = [
    { donor: 'Abbett, Richard E. ', recipient: 'Case, Ed', dp: donor, rp: edCase, amount: 100, date: '2016-06-16', src: 'hawaii_csc', status: 'auto_matched', raw: { _id: 1, Amount: 100, 'Candidate Name': 'Case, Ed', 'Contributor Name': 'Abbett, Richard E. ', 'Election Period': '2014-2016' } },
    { donor: 'Someone Else', recipient: 'Case, Ed', dp: null, rp: edCase, amount: 250.5, date: '2022-01-10', src: 'hawaii_csc', status: 'recipient_matched', raw: { _id: 2, Amount: 250.5 } },
    { donor: 'ACTBLUE', recipient: 'Brian Schatz', dp: null, rp: schatz, amount: 25, date: '2025-12-28', src: 'fec', status: 'recipient_matched', raw: { sub_id: '4030620261411451147', contribution_receipt_amount: 25 } },
    { donor: 'Nobody Known', recipient: 'Nobody Either', dp: null, rp: null, amount: 1000, date: '2024-03-01', src: 'hawaii_csc', status: 'unmatched', raw: { _id: 3 } },
    { donor: 'Bad Match', recipient: 'Case, Ed', dp: null, rp: edCase, amount: 5, date: '2024-03-02', src: 'hawaii_csc', status: 'rejected', raw: { _id: 4 } },
  ]
  for (const c of contribs) {
    await db.query(`insert into legacy.contribution(donor_name_raw, recipient_name_raw, donor_person_id, recipient_person_id, amount, contribution_date, election_period, contribution_type, source, match_status, raw_record, source_file)
                    values ($1,$2,$3,$4,$5,$6,'2024-2026','Individual',$7,$8,$9,'ckan:test')`,
      [c.donor, c.recipient, c.dp, c.rp, c.amount, c.date, c.src, c.status, JSON.stringify(c.raw)])
  }
  await db.query(`insert into legacy.contribution(donor_name_raw, recipient_name_raw, donor_org_id, recipient_person_id, amount, contribution_date, source, match_status, raw_record)
                  values ('Hawaiian Electric PAC','Case, Ed',$1,$2,2000,'2023-05-05','hawaii_csc','auto_matched','{"_id":5}')`, [heco, edCase])

  // lobbying
  await db.query(`insert into legacy.lobbyist_registration(lobbyist_person_id, client_org_id, client_name_raw, registration_period, issues, source_url, raw_record)
                  values ($1,$2,'Hawaii Farm Bureau Federation','2017-2018','{"agriculture"}','http://files.hawaii.gov/ethics/lobreg/x.pdf', '{"_id":1,"Full Name":"Lamosao, Rachele","Lobby Year":"2017-2018","Organization":"Hawaii Farm Bureau Federation"}')`,
    [lobbyist, farmBureau])
  await db.query(`insert into legacy.lobbyist_registration(lobbyist_person_id, client_org_id, client_name_raw, registration_period, raw_record)
                  values (null, null, 'Mystery Client', '2019-2020', '{"_id":2,"Full Name":"Unknown, Person"}')`)
  await db.query(`insert into legacy.lobbyist_expenditure(lobbyist_person_id, client_org_id, amount, period, expenditure_type, raw_record) values ($1,$2,1234.56,'2018','media','{"x":1}')`, [lobbyist, farmBureau])
  await db.query(`insert into legacy.org_lobbying_expenditure(org_id, org_name_raw, amount, period, expenditure_type, raw_record) values ($1,'Hawaiian Electric Industries',50000,'2024','lobbying','{"y":2}')`, [heco])

  // ethics disclosure
  await db.query(`insert into legacy.financial_disclosure(person_id, filing_year, position_held, financial_interests, raw_record) values ($1, 2024, 'State Senator', '{"assets":["home"]}', '{"Name":"Brian Schatz"}')`, [schatz])

  // PUC
  const docket = await db.one<{ id: string }>(`insert into legacy.puc_docket(docket_number, title, docket_type, status, filed_date, utility_type, summary) values ('2024-0158','Hawaii Gas Rate Case','rate_case','open','2024-06-01','gas','Rate case') returning id`)
  await db.query(`insert into legacy.puc_docket(docket_number, title, status) values ('2018-0088','Performance-Based Regulation','open')`)
  await db.query(`insert into legacy.puc_participant(docket_id, organization_id, role) values ($1,$2,'regulator'), ($1,$3,'regulated_entity')`, [docket!.id, puc, heco])

  // editorial
  const article = await db.one<{ id: string }>(`insert into legacy.article(title, url, published_at, source, author, summary, tags) values ('Energy Cooperative Seeks Record Rate Hike','https://hoku.fm/rate-hike','2024-04-01','hoku_fm','P. Medeiros','HEI files for increase','{energy}') returning id`)
  await db.query(`insert into legacy.article_entity_mention(article_id, organization_id, mention_type) values ($1,$2,'subject')`, [article!.id, heco])
  await db.query(`insert into legacy.article_entity_mention(article_id, person_id, mention_type) values ($1,$2,'quoted')`, [article!.id, schatz])

  // timeline
  await db.query(`insert into legacy.timeline_event(person_id, event_date, event_type, title, description) values ($1,'2012-12-26','appointment','Appointed to U.S. Senate','Appointed by Gov.')`, [schatz])
  await db.query(`insert into legacy.timeline_event(organization_id, event_date, event_type, title) values ($1,'2024-06-01','announcement','Filed rate case')`, [heco])

  // testimony (creates bill entities)
  await db.query(`insert into legacy.legislative_testimony(person_id, person_name_raw, bill_number, session, committee, position, hearing_date, match_status, match_confidence, raw_record)
                  values ($1,'Brian Schatz','SB 1234','2026','EEP','support','2026-02-10','auto_matched',1.0,'{"a":1}')`, [schatz])
  await db.query(`insert into legacy.legislative_testimony(organization_id, org_name_raw, bill_number, session, position, hearing_date, match_status, raw_record)
                  values ($1,'Hawaiian Electric','SB1234','2026','oppose','2026-02-10','auto_matched','{"a":2}')`, [heco])
  await db.query(`insert into legacy.legislative_testimony(person_name_raw, bill_number, session, position, match_status, raw_record)
                  values ('Random Citizen','HB 10','2026','comment','unmatched','{"a":3}')`)

  // contracts (agency resolved by exact org name for DoD; unresolved vendor)
  await db.query(`insert into legacy.government_contract(vendor_org_id, vendor_name_raw, match_status, match_confidence, awarding_agency, contract_amount, description, award_date, source, source_record_id, raw_record)
                  values ($1,'HAWAIIAN DREDGING CONSTRUCTION CO','auto_matched',0.97,'Department of Defense',2772165518.15,'Dry dock','2023-03-31','usaspending','N6274223F4007','{"Award ID":"N6274223F4007","Award Amount":2772165518.15}')`, [hdcc])
  await db.query(`insert into legacy.government_contract(vendor_name_raw, match_status, awarding_agency, contract_amount, award_date, source, source_record_id, raw_record)
                  values ('SOME GRANTEE','unmatched','Department of Education',10000,'2024-01-01','usaspending','G1','{"Award ID":"G1","Award Type":"Grant"}')`)

  // property (two rows on one TMK → one parcel)
  await db.query(`insert into legacy.property_ownership(owner_person_id, owner_name_raw, match_status, match_confidence, tmk, address, county, assessed_value, tax_class, assessment_year, raw_record)
                  values ($1,'CASE, ED','auto_matched',1.0,'150010010001','1 Main St','Honolulu',900000,'Residential',2024,'{"p":1}')`, [edCase])
  await db.query(`insert into legacy.property_ownership(owner_name_raw, match_status, tmk, county, assessed_value, assessment_year, raw_record)
                  values ('CASE, ED','review','150010010001','Honolulu',850000,2023,'{"p":2}')`)

  // provenance + cursors
  await db.query(`insert into legacy.data_source_record(source_id, source_name, raw_data, checksum) values ('N6274223F4007','usaspending','{"Award ID":"N6274223F4007"}', repeat('a', 64))`)
  await db.query(`insert into legacy.data_source_record(source_id, source_name, raw_data, checksum) values ('990208097','propublica_990','{"ein":990208097}', repeat('b', 64))`)
  await db.query(`insert into legacy.import_cursor(source, cursor_offset, status, last_run_at, metadata) values ('hawaii_csc', 122344, 'complete', now(), '{"last_inserted":1}'), ('fec', 0, 'complete', now(), '{}')`)

  // users: one mapped, one unmapped
  const u1 = '11111111-1111-4111-8111-111111111111'
  const u2 = '22222222-2222-4222-8222-222222222222'
  await db.query(`insert into legacy.user_profile(id, email, subscription_tier, subscription_status, stripe_customer_id, alert_person_ids) values ($1,'a@example.com','professional','active','cus_A',$2::uuid[]), ($3,'b@example.com','free','inactive',null,'{}')`, [u1, [edCase], u2])
  await db.query(`insert into legacy.staff_role(user_id, role) values ($1,'editor')`, [u1])
  await db.query(`insert into migration_user_map(legacy_user_id, neon_user_id, email) values ($1,'neon_user_a','a@example.com')`, [u1])

  return ids
}
