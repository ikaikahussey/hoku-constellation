/**
 * E3/E4/E5/E10 — citations, client reports, briefings/dossiers, and corpus Q&A.
 * Golden files live in tests/golden/ (regenerate deliberately with UPDATE_GOLDEN=1).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { extractText, getDocumentProxy } from 'unpdf'
import { createTestDb, type TestDb } from './helpers/pglite'
import { EchoModel, FlakyCitationModel, FabricatingModel, InsufficientModel } from './helpers/fake-model'
import { assignHandles, splitSentences, validateCitedSentences, validateCitedText } from '@/lib/ai/citations'
import { generateCitedNarrative, buildPrompt } from '@/lib/ai/claude'
import { createTeam } from '@/lib/teams'
import { getEntitlements, EntitlementError } from '@/lib/entitlements'
import { approveReport, generateReportDraft, getReportFile, lastWeek, runWeeklyAutoDrafts, sendReport, uncitedSentences, updateReportDraft, ReportError, type RichBlock } from '@/lib/reports'
import { buildBillBriefing, buildDossier, connectionPath, getOrBuildBriefing, markStaleBriefings, briefingDocModel } from '@/lib/briefings'
import { renderPdf } from '@/lib/render/pdf'
import { ask, AskError } from '@/lib/ask'
import { MemoryTransport } from '@/lib/email/resend'

process.env.APP_ENCRYPTION_KEY ??= randomBytes(32).toString('base64')

const GOLDEN = join(process.cwd(), 'tests', 'golden')
const NOW = new Date('2027-02-22T20:00:00Z') // Monday 10:00 HST
const PERIOD = { start: '2027-02-15', end: '2027-02-21' }

/** Replace UUIDs with stable placeholders (order of first appearance) and drop timestamps. */
function normalize(value: unknown): unknown {
  const ids = new Map<string, string>()
  const json = JSON.stringify(value, (k, v) => (k === 'generated_at' ? undefined : v), 2)
  return JSON.parse(json.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, m => {
    if (!ids.has(m)) ids.set(m, `<id:${ids.size + 1}>`)
    return ids.get(m)!
  }))
}
function golden(name: string, value: unknown) {
  const file = join(GOLDEN, `${name}.json`)
  const actual = normalize(value)
  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(file)) writeFileSync(file, JSON.stringify(actual, null, 2) + '\n')
  expect(actual).toEqual(JSON.parse(readFileSync(file, 'utf8')))
}

let db: TestDb
const S: Record<string, string> = {}
const ent = async (kind: string, name: string, identifiers: object = {}, attributes: object = {}) =>
  (await db.one<{ id: string }>(`insert into entity(kind, name, identifiers, attributes) values ($1,$2,$3,$4) returning id`, [kind, name, JSON.stringify(identifiers), JSON.stringify(attributes)]))!.id
let n = 0
const doc = async (source: string, doc_type: string, title: string, doc_date: string | null, extra: { sid?: string; raw?: object; body?: string } = {}) =>
  (await db.one<{ id: string }>(`insert into document(source, source_record_id, doc_type, title, doc_date, raw, body_text, checksum) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [source, extra.sid ?? null, doc_type, title, doc_date, JSON.stringify(extra.raw ?? {}), extra.body ?? null, `seed${n++}`.padEnd(64, '0')]))!.id
const edge = (type: string, from: string, to: string, docId: string, extra: { role?: string; amount?: number; start?: string; attrs?: object } = {}) =>
  db.query(`insert into edge(type, from_id, to_id, document_id, role, amount, start_date, attributes, match_status, from_name_raw, to_name_raw)
            values ($1,$2,$3,$4,$5,$6,$7,$8,'matched',(select name from entity where id = $2),(select name from entity where id = $3))`,
    [type, from, to, docId, extra.role ?? null, extra.amount ?? null, extra.start ?? null, JSON.stringify(extra.attrs ?? {})])

beforeAll(async () => {
  db = await createTestDb()
  const team = await createTeam(db, 'rep_owner', 'Kaʻōnohi Consulting', { email: 'owner@example.com' })
  await db.query(`update app.team set plan = 'pro', subscription_status = 'active', sender_name = 'Kaʻōnohi Consulting' where id = $1`, [team.id])
  S.team = team.id
  S.clientEntity = await ent('org', 'Kaiāulu Health Alliance', {}, { slug: 'kaiaulu-health-alliance' })
  S.bill = await ent('bill', 'HB123 (2027)', { measure: '2027:HB123' }, {
    measure_number: 'HB123', session: '2027', title: 'RELATING TO HEALTH.', description: 'Establishes a community health worker certification program.',
    current_status: 'Bill scheduled to be heard by FIN on Tuesday, 02-24-27 9:00AM in House conference room 308.', current_referral: 'HLT, FIN',
  })
  S.measureDoc = await doc('capitol_measures', 'measure', 'HB123 (2027) RELATING TO HEALTH.', '2027-01-20', { sid: '2027:HB123', raw: {
    measure: 'HB123', session: '2027', title: 'RELATING TO HEALTH.', description: 'Establishes a community health worker certification program.',
    statusHistory: [
      { date: '2027-01-20', text: 'Introduced and passed First Reading.' },
      { date: '2027-02-16', text: 'Passed Second Reading as amended in HD 1 and referred to the committee(s) on FIN.' },
      { date: '2027-02-18', text: 'Reported from HLT (Stand. Com. Rep. No. 412) as amended in HD 1, recommending passage on Second Reading.' },
      { date: '2027-02-19', text: 'Bill scheduled to be heard by FIN on Tuesday, 02-24-27 9:00AM in House conference room 308.' },
    ] } })
  S.repA = await ent('person', 'Della Au Belatti', {}, { slug: 'della-au-belatti', entity_types: ['person', 'legislator'] })
  S.repB = await ent('person', 'Kyle Yamashita', {}, { slug: 'kyle-yamashita', entity_types: ['person', 'legislator'] })
  S.repC = await ent('person', 'Gene Ward', {}, { slug: 'gene-ward', entity_types: ['person', 'legislator'] })
  await edge('sponsored', S.repA, S.bill, S.measureDoc, { role: 'introducer', start: '2027-01-20', attrs: { order: 1 } })
  S.hlt = await ent('org', 'House Committee on Health', { committee_code: '2027:H:HLT' })
  S.fin = await ent('org', 'House Committee on Finance', { committee_code: '2027:H:FIN' })
  S.roster = await doc('capitol_committees', 'committee_roster', 'House committee rosters 2027', '2027-01-15')
  await edge('member_of', S.repA, S.hlt, S.roster, { role: 'chair' })
  await edge('member_of', S.repC, S.hlt, S.roster, { role: 'member' })
  await edge('member_of', S.repB, S.fin, S.roster, { role: 'chair' })
  S.voteDoc = await doc('capitol_votes', 'vote', 'HB123 HLT committee vote', '2027-02-17')
  await edge('voted_on', S.repA, S.bill, S.voteDoc, { role: 'aye', start: '2027-02-17', attrs: { committee: 'HLT', vote_type: 'committee' } })
  await edge('voted_on', S.repC, S.bill, S.voteDoc, { role: 'aye with reservations', start: '2027-02-17', attrs: { committee: 'HLT', vote_type: 'committee' } })
  S.testDoc = await doc('capitol_testimony', 'testimony', 'HB123 testimony HLT 02-18-27', '2027-02-18', { body: 'Testimony in support of community health workers.' })
  S.hma = await ent('org', 'Hawaiʻi Medical Association')
  const citizen = await ent('person', 'Keoni Alana')
  await edge('testified_on', S.clientEntity, S.bill, S.testDoc, { role: 'support', start: '2027-02-18', attrs: { committee: 'HLT' } })
  await edge('testified_on', S.hma, S.bill, S.testDoc, { role: 'support', start: '2027-02-18', attrs: { committee: 'HLT' } })
  await edge('testified_on', citizen, S.bill, S.testDoc, { role: 'oppose', start: '2027-02-18', attrs: { committee: 'HLT' } })
  S.cscDoc = await doc('csc', 'contribution', 'CSC contribution report', '2026-06-01')
  await edge('contributed_to', S.hma, S.repB, S.cscDoc, { amount: 1000, start: '2026-06-01' })
  const oldDoc = await doc('csc', 'contribution', 'CSC contribution report 2019', '2019-05-01')
  await edge('contributed_to', S.hma, S.repB, oldDoc, { amount: 5000, start: '2019-05-01' })
  S.cscDoc2 = await doc('csc', 'contribution', 'CSC contribution report 2', '2027-02-16')
  await edge('contributed_to', S.clientEntity, S.repA, S.cscDoc2, { amount: 500, start: '2027-02-16' })
  S.lobDoc = await doc('ethics_lobbyists', 'lobbyist_expenditure', 'Lobbying expenditure statement Jan–Feb 2027', '2027-02-28')
  S.pharma = await ent('org', 'Pacific Pharma Co')
  await edge('lobbied_on', S.pharma, S.bill, S.lobDoc, { role: 'oppose' })
  S.client = (await db.one<{ id: string }>(`insert into app.client(team_id, name, entity_id, report_recipients) values ($1, 'Kaiāulu Health Alliance', $2, '{client@example.org}') returning id`, [S.team, S.clientEntity]))!.id
  S.wl = (await db.one<{ id: string }>(`insert into app.watchlist(team_id, client_id, name) values ($1, $2, 'Kaiāulu bills') returning id`, [S.team, S.client]))!.id
  await db.query(`insert into app.watchlist_item(watchlist_id, entity_id, position) values ($1, $2, 'support')`, [S.wl, S.bill])
})
afterAll(async () => { await db.end() })

// ------------------------------------------------------------------------------------------------ citations

describe('citation validator', () => {
  const fx = JSON.parse(readFileSync('tests/fixtures/citations/uncited.json', 'utf8'))
  const { byHandle } = assignHandles(fx.facts)

  it('rejects the fixture containing an uncited sentence', () => {
    const v = validateCitedSentences(fx.output.sentences, byHandle)
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toMatch(/sentence 2 has no citation/)
    expect(v.sentences).toEqual([])
  })
  it('rejects unknown handles and packed sentences', () => {
    expect(validateCitedSentences([{ text: 'A thing happened.', cites: ['D9'] }], byHandle).errors[0]).toMatch(/unknown source/)
    expect(validateCitedSentences([{ text: 'One thing happened. Another did too.', cites: ['D1'] }], byHandle).errors[0]).toMatch(/contains 2 sentences/)
    expect(validateCitedSentences([], byHandle).ok).toBe(false)
  })
  it('accepts cited sentences and resolves handles to document ids', () => {
    const v = validateCitedSentences([{ text: 'HB 123 passed Second Reading.', cites: ['d1'] }], byHandle)
    expect(v).toEqual({ ok: true, errors: [], sentences: [{ text: 'HB 123 passed Second Reading.', documentIds: ['00000000-0000-4000-8000-000000000001'] }] })
  })
  it('validates free text with inline markers (golden fixtures)', () => {
    expect(validateCitedText(readFileSync('tests/fixtures/citations/valid.txt', 'utf8').trim(), byHandle).ok).toBe(true)
    const bad = validateCitedText(readFileSync('tests/fixtures/citations/uncited.txt', 'utf8').trim(), byHandle)
    expect(bad.ok).toBe(false)
    expect(bad.errors.join(' ')).toMatch(/Supporters expect it to pass the Senate/)
  })
  it('splits sentences without breaking on abbreviations or decimals', () => {
    expect(splitSentences('Stand. Com. Rep. No. 412 was filed. It cost $1.5 million.')).toEqual(['Stand. Com. Rep. No. 412 was filed.', 'It cost $1.5 million.'])
  })
})

describe('cited narrative generation', () => {
  const facts = [{ documentId: '00000000-0000-4000-8000-000000000001', text: 'HB 123 passed Second Reading.' }]
  it('uses a valid model answer', async () => {
    const r = await generateCitedNarrative({ task: 't', facts }, new EchoModel())
    expect(r).toMatchObject({ source: 'model', attempts: 1, errors: [] })
    expect(r.sentences[0].documentIds).toEqual([facts[0].documentId])
  })
  it('retries once after an uncited answer', async () => {
    const m = new FlakyCitationModel(1)
    const r = await generateCitedNarrative({ task: 't', facts }, m)
    expect(r).toMatchObject({ source: 'model', attempts: 2 })
    expect(r.errors[0]).toMatch(/no citation/)
  })
  it('falls back to facts-only after two invalid answers', async () => {
    for (const m of [new FlakyCitationModel(5), new FabricatingModel()]) {
      const r = await generateCitedNarrative({ task: 't', facts }, m)
      expect(r.source).toBe('facts_only')
      expect(r.attempts).toBe(2)
      expect(r.sentences).toEqual([{ text: 'HB 123 passed Second Reading.', documentIds: [facts[0].documentId] }])
    }
  })
  it('is facts-only when no model is configured', async () => {
    expect((await generateCitedNarrative({ task: 't', facts }, null)).source).toBe('facts_only')
  })
  it('sends the model only facts with handles', () => {
    const p = buildPrompt({ task: 'Summarize', facts: [...facts, { documentId: facts[0].documentId, text: 'Same doc again' }] })
    expect(p.user).toMatch(/^D1: HB 123 passed Second Reading\.$/m)
    expect(p.user).toMatch(/^D1: Same doc again$/m)
    expect(p.byHandle.size).toBe(1)
    expect(p.system).toMatch(/Use only the facts provided/)
  })
})

// ------------------------------------------------------------------------------------------------ reports

describe('client reports', () => {
  it('assembles a cited report (golden)', async () => {
    const r = await generateReportDraft(db, { teamId: S.team, clientId: S.client, ...PERIOD, userId: 'rep_owner', model: new EchoModel(6), now: NOW })
    expect(r.status).toBe('draft')
    expect(r.narrative_source).toBe('model')
    for (const s of r.content.sections) for (const i of s.items) expect(i.documentIds.length, i.text).toBeGreaterThan(0)
    for (const b of r.content.narrative.blocks) for (const run of b.runs) expect(run.cites?.length, run.text).toBeGreaterThan(0)
    expect(r.cited_document_ids).toContain(S.measureDoc)
    golden('report-content', r.content)
  })

  it('falls back to a facts-only narrative when the model keeps failing validation', async () => {
    const r = await generateReportDraft(db, { teamId: S.team, clientId: S.client, ...PERIOD, userId: 'rep_owner', model: new FabricatingModel(), now: NOW })
    expect(r.narrative_source).toBe('facts_only')
    expect(r.content.narrative.errors.length).toBe(2)
    golden('report-content-facts-only', r.content)
  })

  it('draft → edit → approve → send; nothing is sent before approval', async () => {
    const r = await generateReportDraft(db, { teamId: S.team, clientId: S.client, ...PERIOD, userId: 'rep_owner', model: new EchoModel(), now: NOW })
    const mail = new MemoryTransport()
    await expect(sendReport(db, { teamId: S.team, reportId: r.id, userId: 'rep_owner', transport: mail })).rejects.toThrow(/Approve the report before sending/)
    expect(mail.sent).toHaveLength(0)

    const blocks: RichBlock[] = [
      { type: 'p', runs: [{ text: 'HB 123 advanced this week ', bold: true }, { text: 'and is set for a FIN hearing. ', cites: [S.measureDoc] }] },
      { type: 'li', runs: [{ text: 'Our testimony was filed. ', cites: [S.testDoc] }, { text: 'Forged citation. ', cites: ['11111111-1111-4111-8111-111111111111'] }] },
    ]
    const edited = await updateReportDraft(db, { teamId: S.team, reportId: r.id, userId: 'rep_owner', blocks, recipients: ['client@example.org', 'not-an-email', 'second@example.org'] })
    expect(edited.narrative_source).toBe('edited')
    expect(edited.recipients).toEqual(['client@example.org', 'second@example.org'])
    expect(JSON.stringify(edited.content.narrative.blocks)).not.toContain('11111111-1111-4111-8111-111111111111')
    expect(uncitedSentences(edited.content.narrative.blocks)).toEqual(['Forged citation.'])

    const approved = await approveReport(db, { teamId: S.team, reportId: r.id, userId: 'rep_owner' })
    expect(approved).toMatchObject({ status: 'approved', approved_by: 'rep_owner' })
    expect(approved.pdf_key).toMatch(/\.pdf$/)

    // Editing an approved report sends it back to draft.
    const back = await updateReportDraft(db, { teamId: S.team, reportId: r.id, userId: 'rep_owner', blocks })
    expect(back.status).toBe('draft')
    expect(back.approved_by).toBeNull()
    await expect(sendReport(db, { teamId: S.team, reportId: r.id, userId: 'rep_owner', transport: mail })).rejects.toThrow(/Approve/)
    await approveReport(db, { teamId: S.team, reportId: r.id, userId: 'rep_owner' })

    const pdf = await getReportFile(db, S.team, r.id, 'pdf')
    const docx = await getReportFile(db, S.team, r.id, 'docx')
    expect(Buffer.from(pdf!.bytes).subarray(0, 5).toString()).toBe('%PDF-')
    expect(Buffer.from(docx!.bytes).subarray(0, 2).toString()).toBe('PK')
    const text = (await extractText(await getDocumentProxy(pdf!.bytes), { mergePages: true })).text
    expect(text).toContain('Kaiāulu Health Alliance')
    expect(text).toContain('Kaʻōnohi Consulting')
    expect(text).toMatch(/Sources/)
    expect(text).toMatch(/\[1\]/)

    const sent = await sendReport(db, { teamId: S.team, reportId: r.id, userId: 'rep_owner', transport: mail })
    expect(sent.status).toBe('sent')
    expect(mail.sent).toHaveLength(1)
    expect(mail.sent[0]).toMatchObject({ to: ['client@example.org', 'second@example.org'], fromName: 'Kaʻōnohi Consulting' })
    expect(mail.sent[0].attachments!.map(a => a.filename)).toEqual([expect.stringMatching(/\.pdf$/), expect.stringMatching(/\.docx$/)])
    await expect(updateReportDraft(db, { teamId: S.team, reportId: r.id, userId: 'rep_owner', blocks })).rejects.toThrow(/sent report cannot be edited/)
    await expect(sendReport(db, { teamId: S.team, reportId: r.id, userId: 'rep_owner', transport: mail })).rejects.toBeInstanceOf(ReportError)
  })

  it('non-members and Reader teams cannot generate reports', async () => {
    await expect(generateReportDraft(db, { teamId: S.team, clientId: S.client, ...PERIOD, userId: 'stranger', model: null })).rejects.toThrow(/Not a member/)
    const reader = await createTeam(db, 'reader_user', 'Reader team')
    await db.query(`update app.team set plan = 'reader', subscription_status = 'active' where id = $1`, [reader.id])
    await expect(generateReportDraft(db, { teamId: reader.id, clientId: S.client, ...PERIOD, userId: 'reader_user', model: null })).rejects.toBeInstanceOf(EntitlementError)
  })

  it('weekly auto-draft creates a draft (never sends) and notifies owners/admins, once per week', async () => {
    expect(lastWeek(NOW)).toEqual(PERIOD)
    await db.query(`update app.client set auto_draft = true where id = $1`, [S.client])
    await db.query(`delete from app.report where period_start = $1 and period_end = $2`, [PERIOD.start, PERIOD.end])
    const mail = new MemoryTransport()
    expect(await runWeeklyAutoDrafts(db, { now: NOW, transport: mail, model: new EchoModel() })).toBe(1)
    expect(await runWeeklyAutoDrafts(db, { now: NOW, transport: mail, model: new EchoModel() })).toBe(0)
    const r = await db.many<{ status: string }>(`select status from app.report where client_id = $1 and period_start = $2`, [S.client, PERIOD.start])
    expect(r).toEqual([{ status: 'draft' }])
    expect(mail.sent).toHaveLength(1)
    expect(mail.sent[0].to).toEqual(['owner@example.com'])
    expect(mail.sent[0].text).toMatch(/will not be sent until someone on your team approves it/)
  })
})

// ------------------------------------------------------------------------------------------------ briefings

describe('bill briefings and dossiers', () => {
  it('builds a cited bill briefing (golden) with factual indicators only', async () => {
    const b = await buildBillBriefing(db, S.bill, { model: new EchoModel(), now: NOW })
    for (const s of b.sections) for (const l of s.lines) expect(l.documentIds.length, l.text).toBeGreaterThan(0)
    const indicators = b.sections.find(s => s.key === 'indicators')!
    expect(indicators.title).toBe('Indicators')
    expect(JSON.stringify(indicators)).not.toMatch(/\b(predict(?!s? an outcome)|likely|will pass|chance|odds|probab)/i)
    expect(indicators.lines.map(l => l.text)).toEqual([
      'Testimony balance: 2 support, 1 oppose, 0 comments',
      'Sponsors: 1 legislator (1 introducer, 0 co-introducers)',
      'Committee and floor votes so far: 1 aye, 1 aye with reservations',
    ])
    const money = b.sections.find(s => s.key === 'money')!
    // Kaiāulu both testified and gave to the introducer, so both gifts qualify; the 2019 gift is outside two cycles.
    expect(money.lines.map(l => l.text)).toEqual([
      'Hawaiʻi Medical Association → Kyle Yamashita: $1,000 in 1 contribution',
      'Kaiāulu Health Alliance → Della Au Belatti: $500 in 1 contribution',
    ])
    expect(b.sections.find(s => s.key === 'lobbying')!.lines[0].text).toMatch(/Pacific Pharma Co \(oppose\) reported lobbying/)
    expect(b.sections.find(s => s.key === 'committees')!.lines.map(l => l.text)).toEqual([
      'HLT members: Della Au Belatti (chair), Gene Ward',
      'HLT vote: aye — Della Au Belatti; aye with reservations — Gene Ward',
      'FIN members: Kyle Yamashita (chair)',
    ])
    golden('bill-briefing', b)
  })

  it('caches briefings and regenerates after a new document touches the bill', async () => {
    const first = await getOrBuildBriefing(db, S.bill, { model: new EchoModel() })
    const again = await getOrBuildBriefing(db, S.bill, { model: new EchoModel() })
    expect(String(again.generated_at)).toBe(String(first.generated_at))
    const since = new Date(Date.now() - 1000)
    const d = await doc('capitol_testimony', 'testimony', 'Late testimony', '2027-02-20')
    await edge('testified_on', S.pharma, S.bill, d, { role: 'oppose' })
    expect(await markStaleBriefings(db, since)).toBe(1)
    const rebuilt = await getOrBuildBriefing(db, S.bill, { model: new EchoModel() })
    expect(rebuilt.stale).toBe(false)
    expect(JSON.stringify(rebuilt.content)).toMatch(/2 support, 2 oppose/)
    const pdf = await renderPdf(await briefingDocModel(db, rebuilt))
    const text = (await extractText(await getDocumentProxy(pdf), { mergePages: true })).text
    expect(text).toMatch(/Bill briefing: HB123 \(2027\)/)
    expect(text).toMatch(/does not predict an outcome/)
  })

  it('builds a person dossier with connection paths to watched entities', async () => {
    const d = await buildDossier(db, S.repA, { model: new EchoModel(), watchIds: [S.clientEntity, S.hma], now: NOW })
    const titles = Object.fromEntries(d.sections.map(s => [s.key, s.lines.map(l => l.text)]))
    expect(titles.roles).toContain('member of House Committee on Health — chair')
    expect(titles.money_in).toEqual(['From Kaiāulu Health Alliance: $500 in 1 record'])
    expect(titles.paths[0]).toMatch(/Della Au Belatti —contributed to— Kaiāulu Health Alliance|Kaiāulu Health Alliance/)
    for (const s of d.sections) for (const l of s.lines) expect(l.documentIds.length).toBeGreaterThan(0)
    const p = await connectionPath(db, S.repA, S.hma)
    expect(p!.documentIds.length).toBeGreaterThanOrEqual(2)
    expect(await connectionPath(db, S.repA, await ent('person', 'Isolated Person'))).toBeNull()
  })
})

// ------------------------------------------------------------------------------------------------ Q&A

describe('Ask HOKU Insider', () => {
  it('answers with citations, logs only length and result count', async () => {
    const e = await getEntitlements(db, 'rep_owner')
    const r = await ask(db, { userId: 'rep_owner', teamId: S.team, question: 'Who contributed money to Della Au Belatti?', entitlements: e, model: new EchoModel(), embed: null })
    expect(r.answeredBy).toBe('model')
    expect(r.answer.length).toBeGreaterThan(0)
    for (const s of r.answer) expect(s.documentIds.length).toBeGreaterThan(0)
    expect(r.answer.map(s => s.text).join(' ')).toMatch(/Kaiāulu Health Alliance contributed to Della Au Belatti/)
    const log = await db.many(`select * from app.ask_log where user_id = 'rep_owner'`)
    expect(Object.keys(log[0]).sort()).toEqual(['created_at', 'id', 'question_length', 'result_count', 'team_id', 'user_id'])
    expect(log[0]).toMatchObject({ question_length: 42 })
  })

  it('says so when the corpus does not support an answer', async () => {
    const e = await getEntitlements(db, 'rep_owner')
    const none = await ask(db, { userId: 'rep_owner', teamId: S.team, question: 'Zzyzx quuxinator frobnication?', entitlements: e, model: new EchoModel(), embed: null })
    expect(none).toMatchObject({ insufficient: true, answer: [], answeredBy: 'none', resultCount: 0 })
    const said = await ask(db, { userId: 'rep_owner', teamId: S.team, question: 'What did community health workers testimony say?', entitlements: e, model: new InsufficientModel(), embed: null })
    expect(said.insufficient).toBe(true)
  })

  it('applies filters (source, date range, entity)', async () => {
    const e = await getEntitlements(db, 'rep_owner')
    const r = await ask(db, { userId: 'rep_owner', teamId: S.team, question: 'community health workers testimony', filters: { source: 'csc' }, entitlements: e, model: new EchoModel(), embed: null })
    expect(r.sources.every(s => s.source === 'csc')).toBe(true)
  })

  it('enforces per-tier daily limits; Reader has none', async () => {
    const reader = await createTeam(db, 'reader_asker', 'Reader asker')
    await db.query(`update app.team set plan = 'reader', subscription_status = 'active' where id = $1`, [reader.id])
    const re = await getEntitlements(db, 'reader_asker')
    await expect(ask(db, { userId: 'reader_asker', teamId: reader.id, question: 'Anything at all?', entitlements: re, model: null, embed: null })).rejects.toMatchObject({ status: 403 })
    const pro = await createTeam(db, 'busy_asker', 'Busy')
    await db.query(`update app.team set plan = 'pro', subscription_status = 'active' where id = $1`, [pro.id])
    const pe = await getEntitlements(db, 'busy_asker')
    expect(pe.qa_daily_limit).toBe(100)
    await db.query(`insert into app.ask_log(user_id, question_length, result_count) select 'busy_asker', 10, 1 from generate_series(1, 100)`)
    const err = await ask(db, { userId: 'busy_asker', teamId: pro.id, question: 'One more question?', entitlements: pe, model: null, embed: null }).catch(x => x)
    expect(err).toBeInstanceOf(AskError)
    expect(err.status).toBe(429)
    await db.query(`update app.team set plan = 'organization' where id = $1`, [pro.id])
    const oe = await getEntitlements(db, 'busy_asker')
    expect(oe.qa_daily_limit).toBe(300)
    await expect(ask(db, { userId: 'busy_asker', teamId: pro.id, question: 'One more question?', entitlements: oe, model: null, embed: null })).resolves.toBeTruthy()
  })
})
