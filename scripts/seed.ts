import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function seed() {
  console.log('Seeding database...')

  // --- PEOPLE ---
  const people = [
    { full_name: 'Keoni Nakamura', first_name: 'Keoni', last_name: 'Nakamura', slug: 'keoni-nakamura', entity_types: ['elected_official'], office_held: 'State Senator, District 13', party: 'Democrat', district: 'District 13', island: 'Oahu', status: 'active', is_featured: true, visibility: 'public', bio_summary: 'Keoni Nakamura has served in the Hawaii State Senate since 2018, representing District 13 on the Windward side of Oahu. He chairs the Energy and Environment Committee and is known for his advocacy on renewable energy policy and Hawaiian homelands reform.' },
    { full_name: 'Leilani Ka\u02BBeo', first_name: 'Leilani', last_name: 'Kaeo', slug: 'leilani-kaeo', entity_types: ['elected_official'], office_held: 'State Representative, District 44', party: 'Democrat', district: 'District 44', island: 'Maui', status: 'active', is_featured: true, visibility: 'public', bio_summary: 'Leilani Ka\u02BBeo represents central Maui in the Hawaii House of Representatives. She is a former public school teacher who ran on a platform of housing affordability and education funding.' },
    { full_name: 'Marcus Wong', first_name: 'Marcus', last_name: 'Wong', slug: 'marcus-wong', entity_types: ['lobbyist', 'business_leader'], office_held: null, party: null, district: null, island: 'Oahu', status: 'active', is_featured: true, visibility: 'gated', bio_summary: 'Marcus Wong is a prominent Honolulu lobbyist and managing partner at Pacific Policy Group. He represents major energy, real estate, and tourism clients before the state legislature and regulatory agencies.' },
    { full_name: 'Haunani Pukui', first_name: 'Haunani', last_name: 'Pukui', slug: 'haunani-pukui', entity_types: ['nonprofit_leader', 'cultural_practitioner'], office_held: null, party: null, district: null, island: 'Hawaii', status: 'active', is_featured: true, visibility: 'gated', bio_summary: 'Haunani Pukui is executive director of the Mauna Kea Conservation Alliance and a recognized authority on Native Hawaiian land rights. She previously served on the BLNR.' },
    { full_name: 'David Chung', first_name: 'David', last_name: 'Chung', slug: 'david-chung', entity_types: ['appointed_official'], office_held: 'PUC Commissioner', party: null, district: null, island: 'Oahu', status: 'active', is_featured: false, visibility: 'gated', bio_summary: 'David Chung serves as a commissioner on the Hawaii Public Utilities Commission. He was appointed in 2022 after a career in energy consulting.' },
    { full_name: 'Sarah Lindgren', first_name: 'Sarah', last_name: 'Lindgren', slug: 'sarah-lindgren', entity_types: ['donor', 'business_leader'], office_held: null, party: null, district: null, island: 'Oahu', status: 'active', is_featured: false, visibility: 'gated', bio_summary: 'Sarah Lindgren is CEO of Pacific Horizons Development, one of the largest real estate developers in Honolulu. She is a major campaign donor and serves on several nonprofit boards.' },
    { full_name: 'James Tavares', first_name: 'James', last_name: 'Tavares', slug: 'james-tavares', entity_types: ['labor_leader'], office_held: 'President, ILWU Local 142', party: null, district: null, island: 'Statewide', status: 'active', is_featured: false, visibility: 'gated', bio_summary: 'James Tavares has led ILWU Local 142 since 2019 and is one of the most influential labor leaders in the state.' },
    { full_name: 'Amy Takeshita', first_name: 'Amy', last_name: 'Takeshita', slug: 'amy-takeshita', entity_types: ['legal_professional', 'lobbyist'], office_held: null, party: null, district: null, island: 'Oahu', status: 'active', is_featured: false, visibility: 'gated', bio_summary: 'Amy Takeshita is Of Counsel at Chang & Associates and a registered lobbyist representing healthcare and pharmaceutical interests.' },
    { full_name: 'Robert Kalani', first_name: 'Robert', last_name: 'Kalani', slug: 'robert-kalani', entity_types: ['elected_official'], office_held: 'Mayor, County of Hawaii', party: 'Democrat', district: null, island: 'Hawaii', status: 'active', is_featured: true, visibility: 'public', bio_summary: 'Robert Kalani is the mayor of Hawaii County, elected in 2024 on a platform of sustainable development and climate resilience.' },
    { full_name: 'Patricia Medeiros', first_name: 'Patricia', last_name: 'Medeiros', slug: 'patricia-medeiros', entity_types: ['media_figure'], office_held: null, party: null, district: null, island: 'Oahu', status: 'active', is_featured: false, visibility: 'gated', bio_summary: 'Patricia Medeiros is the investigative editor at Hoku.fm, where she covers government accountability and campaign finance.' },
  ]

  const { data: insertedPeople, error: peopleError } = await supabase.from('person').insert(people).select('id, full_name, slug')
  if (peopleError) { console.error('People error:', peopleError); return }
  console.log(`Inserted ${insertedPeople.length} people`)

  const personMap = new Map(insertedPeople.map(p => [p.slug, p.id]))

  // --- ORGANIZATIONS ---
  const orgs = [
    { name: 'Hawaii State Legislature', slug: 'hawaii-state-legislature', org_type: 'government_agency', sector: 'education', island: 'Statewide', status: 'active', is_featured: true, visibility: 'public', description: 'The bicameral legislature of the State of Hawaii, consisting of the Senate and House of Representatives.' },
    { name: 'Hawaii Public Utilities Commission', slug: 'hawaii-puc', org_type: 'government_agency', sector: 'energy', island: 'Statewide', status: 'active', is_featured: true, visibility: 'public', description: 'Regulates electric, gas, telecommunications, and private water and sewage companies in the state.' },
    { name: 'Pacific Policy Group', slug: 'pacific-policy-group', org_type: 'lobbying_firm', sector: 'other', island: 'Oahu', status: 'active', is_featured: false, visibility: 'gated', description: 'One of Honolulu\'s largest lobbying firms, representing clients in energy, real estate, and tourism.' },
    { name: 'Pacific Horizons Development', slug: 'pacific-horizons-development', org_type: 'corporation', sector: 'real_estate', island: 'Oahu', status: 'active', is_featured: false, visibility: 'gated', description: 'Major Honolulu-based real estate development company focused on residential and commercial projects.' },
    { name: 'Mauna Kea Conservation Alliance', slug: 'mauna-kea-conservation-alliance', org_type: 'nonprofit', sector: 'other', island: 'Hawaii', status: 'active', is_featured: true, visibility: 'public', description: 'Environmental and cultural nonprofit dedicated to protecting Mauna Kea and Native Hawaiian sacred sites.' },
    { name: 'ILWU Local 142', slug: 'ilwu-local-142', org_type: 'labor_union', sector: 'other', island: 'Statewide', status: 'active', is_featured: false, visibility: 'gated', description: 'Hawaii\'s largest private-sector union representing workers in tourism, agriculture, and longshore.' },
    { name: 'Chang & Associates', slug: 'chang-associates', org_type: 'law_firm', sector: 'other', island: 'Oahu', status: 'active', is_featured: false, visibility: 'gated', description: 'Honolulu law firm with a government affairs and regulatory practice.' },
    { name: 'Hawaii Energy Cooperative', slug: 'hawaii-energy-cooperative', org_type: 'utility', sector: 'energy', island: 'Statewide', status: 'active', is_featured: true, visibility: 'gated', description: 'Statewide electric utility formed from the restructuring of the former monopoly utility provider.' },
    { name: 'Friends of Keoni Nakamura', slug: 'friends-of-keoni-nakamura', org_type: 'pac', sector: 'other', island: 'Oahu', status: 'active', is_featured: false, visibility: 'gated', description: 'Campaign committee for State Senator Keoni Nakamura.' },
    { name: 'Hoku.fm', slug: 'hokufm', org_type: 'media_outlet', sector: 'other', island: 'Oahu', status: 'active', is_featured: true, visibility: 'public', description: 'Hawaii\'s independent media network, based at Kalihi Valley Station in Honolulu.' },
  ]

  const { data: insertedOrgs, error: orgsError } = await supabase.from('organization').insert(orgs).select('id, slug')
  if (orgsError) { console.error('Orgs error:', orgsError); return }
  console.log(`Inserted ${insertedOrgs.length} organizations`)

  const orgMap = new Map(insertedOrgs.map(o => [o.slug, o.id]))

  // --- RELATIONSHIPS ---
  const relationships = [
    { source_person_id: personMap.get('keoni-nakamura'), target_org_id: orgMap.get('hawaii-state-legislature'), relationship_type: 'employee', title: 'State Senator', is_current: true, source_description: 'Hawaii State Legislature records' },
    { source_person_id: personMap.get('leilani-kaeo'), target_org_id: orgMap.get('hawaii-state-legislature'), relationship_type: 'employee', title: 'State Representative', is_current: true },
    { source_person_id: personMap.get('marcus-wong'), target_org_id: orgMap.get('pacific-policy-group'), relationship_type: 'officer', title: 'Managing Partner', is_current: true },
    { source_person_id: personMap.get('marcus-wong'), target_org_id: orgMap.get('hawaii-energy-cooperative'), relationship_type: 'lobbyist_for', title: 'Registered Lobbyist', is_current: true },
    { source_person_id: personMap.get('marcus-wong'), target_org_id: orgMap.get('pacific-horizons-development'), relationship_type: 'lobbyist_for', title: 'Registered Lobbyist', is_current: true },
    { source_person_id: personMap.get('haunani-pukui'), target_org_id: orgMap.get('mauna-kea-conservation-alliance'), relationship_type: 'officer', title: 'Executive Director', is_current: true },
    { source_person_id: personMap.get('david-chung'), target_org_id: orgMap.get('hawaii-puc'), relationship_type: 'appointed_by', title: 'Commissioner', is_current: true, source_description: 'Governor appointment records' },
    { source_person_id: personMap.get('sarah-lindgren'), target_org_id: orgMap.get('pacific-horizons-development'), relationship_type: 'officer', title: 'CEO', is_current: true },
    { source_person_id: personMap.get('sarah-lindgren'), target_org_id: orgMap.get('mauna-kea-conservation-alliance'), relationship_type: 'board_member', title: 'Board Member', is_current: true },
    { source_person_id: personMap.get('james-tavares'), target_org_id: orgMap.get('ilwu-local-142'), relationship_type: 'officer', title: 'President', is_current: true },
    { source_person_id: personMap.get('amy-takeshita'), target_org_id: orgMap.get('chang-associates'), relationship_type: 'employee', title: 'Of Counsel', is_current: true },
    { source_person_id: personMap.get('patricia-medeiros'), target_org_id: orgMap.get('hokufm'), relationship_type: 'employee', title: 'Investigative Editor', is_current: true },
    { source_person_id: personMap.get('keoni-nakamura'), target_person_id: personMap.get('leilani-kaeo'), relationship_type: 'affiliated_with', title: 'Legislative allies', is_current: true },
    { source_person_id: personMap.get('sarah-lindgren'), target_person_id: personMap.get('keoni-nakamura'), relationship_type: 'donor_to', title: 'Major donor', is_current: true, source_description: 'Campaign Spending Commission records' },
    { source_org_id: orgMap.get('pacific-policy-group'), target_org_id: orgMap.get('hawaii-state-legislature'), relationship_type: 'lobbyist_for', is_current: true },
    { source_person_id: personMap.get('david-chung'), target_org_id: orgMap.get('hawaii-energy-cooperative'), relationship_type: 'employee', title: 'Former Senior Consultant', is_current: false, source_description: 'Ethics disclosure 2022' },
    // Additional cross-cutting relationships
    { source_person_id: personMap.get('james-tavares'), target_person_id: personMap.get('keoni-nakamura'), relationship_type: 'affiliated_with', title: 'Political endorsement', is_current: true },
    { source_person_id: personMap.get('marcus-wong'), target_person_id: personMap.get('david-chung'), relationship_type: 'affiliated_with', title: 'Former colleagues', is_current: false },
    { source_org_id: orgMap.get('ilwu-local-142'), target_org_id: orgMap.get('friends-of-keoni-nakamura'), relationship_type: 'donor_to', is_current: true },
    { source_person_id: personMap.get('robert-kalani'), target_org_id: orgMap.get('mauna-kea-conservation-alliance'), relationship_type: 'board_member', title: 'Former Board Chair', is_current: false },
    { source_org_id: orgMap.get('hawaii-energy-cooperative'), target_org_id: orgMap.get('hawaii-puc'), relationship_type: 'affiliated_with', title: 'Regulated utility', is_current: true },
    { source_person_id: personMap.get('haunani-pukui'), target_person_id: personMap.get('robert-kalani'), relationship_type: 'affiliated_with', title: 'Conservation advocacy partners', is_current: true },
    { source_person_id: personMap.get('amy-takeshita'), target_org_id: orgMap.get('hawaii-state-legislature'), relationship_type: 'lobbyist_for', title: 'Healthcare lobbyist', is_current: true },
    { source_person_id: personMap.get('sarah-lindgren'), target_person_id: personMap.get('leilani-kaeo'), relationship_type: 'donor_to', title: 'Campaign donor', is_current: true },
    { source_org_id: orgMap.get('pacific-horizons-development'), target_org_id: orgMap.get('friends-of-keoni-nakamura'), relationship_type: 'donor_to', is_current: true },
    { source_person_id: personMap.get('marcus-wong'), target_person_id: personMap.get('keoni-nakamura'), relationship_type: 'lobbyist_for', title: 'Energy policy lobbying', is_current: true },
    { source_person_id: personMap.get('patricia-medeiros'), target_person_id: personMap.get('marcus-wong'), relationship_type: 'affiliated_with', title: 'Reporting subject', is_current: true },
    { source_org_id: orgMap.get('chang-associates'), target_org_id: orgMap.get('hawaii-puc'), relationship_type: 'counsel', title: 'Legal representation', is_current: true },
    { source_person_id: personMap.get('leilani-kaeo'), target_org_id: orgMap.get('ilwu-local-142'), relationship_type: 'affiliated_with', title: 'Endorsed by', is_current: true },
    { source_person_id: personMap.get('robert-kalani'), target_org_id: orgMap.get('hawaii-state-legislature'), relationship_type: 'predecessor', title: 'Former state rep', is_current: false },
  ]

  const { error: relError } = await supabase.from('relationship').insert(relationships)
  if (relError) console.error('Relationships error:', relError)
  else console.log(`Inserted ${relationships.length} relationships`)

  // --- CONTRIBUTIONS ---
  const contributions = []
  const donors = [
    { name: 'Sarah Lindgren', personId: personMap.get('sarah-lindgren') },
    { name: 'Pacific Horizons Development', orgId: orgMap.get('pacific-horizons-development') },
    { name: 'ILWU Local 142 PAC', orgId: orgMap.get('ilwu-local-142') },
    { name: 'Marcus Wong', personId: personMap.get('marcus-wong') },
    { name: 'John Doe', personId: null },
    { name: 'Jane Smith', personId: null },
    { name: 'Hawaii Energy Cooperative PAC', orgId: orgMap.get('hawaii-energy-cooperative') },
    { name: 'Chang & Associates', orgId: orgMap.get('chang-associates') },
  ]
  const recipients = [
    { name: 'Friends of Keoni Nakamura', personId: personMap.get('keoni-nakamura'), orgId: orgMap.get('friends-of-keoni-nakamura') },
    { name: 'Leilani Kaeo Campaign', personId: personMap.get('leilani-kaeo') },
    { name: 'Robert Kalani for Mayor', personId: personMap.get('robert-kalani') },
  ]

  for (let i = 0; i < 50; i++) {
    const donor = donors[i % donors.length]
    const recipient = recipients[i % recipients.length]
    const amount = [100, 250, 500, 1000, 2000, 5000, 6900][Math.floor(Math.random() * 7)]
    const year = [2022, 2023, 2024, 2025][Math.floor(Math.random() * 4)]
    const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')

    contributions.push({
      donor_name_raw: donor.name,
      recipient_name_raw: recipient.name,
      donor_person_id: donor.personId || null,
      donor_org_id: (donor as Record<string, unknown>).orgId || null,
      recipient_person_id: recipient.personId || null,
      recipient_org_id: (recipient as Record<string, unknown>).orgId || null,
      amount,
      contribution_date: `${year}-${month}-15`,
      election_period: `${year}-General`,
      contribution_type: donor.personId ? 'individual' : 'corporate',
      source: 'state_csc',
      match_status: donor.personId || (donor as Record<string, unknown>).orgId ? 'auto_matched' : 'unmatched',
      match_confidence: donor.personId || (donor as Record<string, unknown>).orgId ? 0.98 : null,
    })
  }

  const { error: contribError } = await supabase.from('contribution').insert(contributions)
  if (contribError) console.error('Contributions error:', contribError)
  else console.log(`Inserted ${contributions.length} contributions`)

  // --- PUC DOCKETS ---
  const dockets = [
    { docket_number: '2024-0158', title: 'Application for Rate Increase - Hawaii Energy Cooperative', docket_type: 'rate_case', status: 'open', filed_date: '2024-03-15', utility_type: 'electric', summary: 'HEC requests a 12% rate increase citing infrastructure investments.' },
    { docket_number: '2024-0201', title: 'Investigation into Renewable Portfolio Standards Compliance', docket_type: 'investigation', status: 'open', filed_date: '2024-06-01', utility_type: 'electric' },
    { docket_number: '2023-0089', title: 'Community Solar Program Implementation', docket_type: 'application', status: 'closed', filed_date: '2023-02-10', decision_date: '2023-11-15', utility_type: 'electric' },
    { docket_number: '2024-0310', title: 'Broadband Infrastructure Expansion Application', docket_type: 'application', status: 'pending', filed_date: '2024-09-01', utility_type: 'telecom' },
    { docket_number: '2023-0145', title: 'Water Rate Adjustment - Kauai Utility', docket_type: 'rate_case', status: 'closed', filed_date: '2023-05-20', decision_date: '2024-01-10', utility_type: 'water' },
  ]

  const { data: insertedDockets, error: docketError } = await supabase.from('puc_docket').insert(dockets).select('id, docket_number')
  if (docketError) console.error('Dockets error:', docketError)
  else console.log(`Inserted ${insertedDockets.length} PUC dockets`)

  const docketMap = new Map(insertedDockets?.map(d => [d.docket_number, d.id]) || [])

  // PUC Participants
  const participants = [
    { docket_id: docketMap.get('2024-0158'), organization_id: orgMap.get('hawaii-energy-cooperative'), role: 'applicant' },
    { docket_id: docketMap.get('2024-0158'), person_id: personMap.get('david-chung'), role: 'commissioner' },
    { docket_id: docketMap.get('2024-0158'), organization_id: orgMap.get('chang-associates'), role: 'counsel' },
    { docket_id: docketMap.get('2024-0201'), organization_id: orgMap.get('hawaii-puc'), role: 'applicant' },
    { docket_id: docketMap.get('2024-0201'), person_id: personMap.get('david-chung'), role: 'commissioner' },
    { docket_id: docketMap.get('2023-0089'), organization_id: orgMap.get('hawaii-energy-cooperative'), role: 'applicant' },
    { docket_id: docketMap.get('2023-0089'), organization_id: orgMap.get('mauna-kea-conservation-alliance'), role: 'intervenor' },
  ]

  const { error: partError } = await supabase.from('puc_participant').insert(participants)
  if (partError) console.error('Participants error:', partError)
  else console.log(`Inserted ${participants.length} PUC participants`)

  // --- ARTICLES ---
  const articles = [
    { title: 'Energy Cooperative Seeks Record Rate Hike', url: 'https://hoku.fm/energy-rate-hike-2024', published_at: '2024-04-01', source: 'hoku_fm', author: 'Patricia Medeiros', summary: 'Hawaii Energy Cooperative files for a 12% rate increase, the largest in a decade.', tags: ['energy', 'puc', 'rates'] },
    { title: 'Lobbyist Connections: Who Speaks for Energy in the Capitol?', url: 'https://hoku.fm/lobbyist-energy-capitol', published_at: '2024-02-15', source: 'hoku_fm', author: 'Patricia Medeiros', summary: 'An investigation into the lobbying network around energy policy at the state legislature.', tags: ['lobbying', 'energy', 'investigation'] },
    { title: 'Nakamura Introduces Renewable Energy Mandate Bill', url: 'https://hoku.fm/nakamura-renewable-bill', published_at: '2024-01-20', source: 'hoku_fm', summary: 'Senator Keoni Nakamura proposes ambitious 100% renewable target by 2040.', tags: ['energy', 'legislation'] },
    { title: 'Developer Donations Raise Questions in Housing Debate', url: 'https://hoku.fm/developer-donations-housing', published_at: '2024-05-10', source: 'hoku_fm', author: 'Patricia Medeiros', summary: 'Campaign finance records show major donations from developers to housing committee members.', tags: ['campaign_finance', 'housing', 'investigation'] },
    { title: 'ILWU Endorses Kalani for Hawaii County Mayor', url: 'https://hoku.fm/ilwu-endorses-kalani', published_at: '2024-07-01', source: 'hoku_fm', summary: 'The state\'s largest private-sector union backs Robert Kalani in the mayoral race.', tags: ['labor', 'election', 'hawaii_island'] },
    { title: 'Mauna Kea Alliance Wins Legal Battle on Access Road', url: 'https://hoku.fm/mauna-kea-access-road', published_at: '2024-03-15', source: 'hoku_fm', summary: 'The conservation group prevails in court over proposed development near Mauna Kea.', tags: ['environment', 'legal', 'hawaii_island'] },
    { title: 'PUC Commissioner\'s Former Employer Now Before the Commission', url: 'https://hoku.fm/puc-conflict-interest', published_at: '2024-08-20', source: 'hoku_fm', author: 'Patricia Medeiros', summary: 'Ethics questions arise as Commissioner Chung reviews rate case from his former employer.', tags: ['puc', 'ethics', 'investigation'] },
    { title: 'Campaign Finance Report: Q3 2024 Top Donors', url: 'https://hoku.fm/q3-2024-donors', published_at: '2024-10-15', source: 'hoku_fm', summary: 'Analysis of the largest campaign donors in the third quarter of 2024.', tags: ['campaign_finance', 'analysis'] },
    { title: 'Kaeo Champions Teacher Pay Raise in House Floor Speech', url: 'https://hoku.fm/kaeo-teacher-pay', published_at: '2024-04-25', source: 'hoku_fm', summary: 'Representative Leilani Kaeo delivers impassioned speech on education funding.', tags: ['education', 'legislation'] },
    { title: 'Affordable Housing Crisis: Who Benefits From the Status Quo?', url: 'https://hoku.fm/housing-crisis-beneficiaries', published_at: '2024-06-01', source: 'hoku_fm', author: 'Patricia Medeiros', summary: 'A deep look at the developers, lobbyists, and politicians connected to Hawaii\'s housing policies.', tags: ['housing', 'investigation', 'long_read'] },
  ]

  const { data: insertedArticles, error: artError } = await supabase.from('article').insert(articles).select('id, title')
  if (artError) console.error('Articles error:', artError)
  else console.log(`Inserted ${insertedArticles.length} articles`)

  // Article-entity mentions
  const articleMap = new Map(insertedArticles?.map(a => [a.title, a.id]) || [])
  const mentions = [
    { article_id: articleMap.get('Energy Cooperative Seeks Record Rate Hike'), organization_id: orgMap.get('hawaii-energy-cooperative'), mention_type: 'subject' },
    { article_id: articleMap.get('Energy Cooperative Seeks Record Rate Hike'), person_id: personMap.get('david-chung'), mention_type: 'mentioned' },
    { article_id: articleMap.get('Lobbyist Connections: Who Speaks for Energy in the Capitol?'), person_id: personMap.get('marcus-wong'), mention_type: 'investigated' },
    { article_id: articleMap.get('Lobbyist Connections: Who Speaks for Energy in the Capitol?'), organization_id: orgMap.get('pacific-policy-group'), mention_type: 'investigated' },
    { article_id: articleMap.get('Nakamura Introduces Renewable Energy Mandate Bill'), person_id: personMap.get('keoni-nakamura'), mention_type: 'subject' },
    { article_id: articleMap.get('Developer Donations Raise Questions in Housing Debate'), person_id: personMap.get('sarah-lindgren'), mention_type: 'investigated' },
    { article_id: articleMap.get('Developer Donations Raise Questions in Housing Debate'), organization_id: orgMap.get('pacific-horizons-development'), mention_type: 'investigated' },
    { article_id: articleMap.get('ILWU Endorses Kalani for Hawaii County Mayor'), person_id: personMap.get('robert-kalani'), mention_type: 'subject' },
    { article_id: articleMap.get('ILWU Endorses Kalani for Hawaii County Mayor'), organization_id: orgMap.get('ilwu-local-142'), mention_type: 'subject' },
    { article_id: articleMap.get('ILWU Endorses Kalani for Hawaii County Mayor'), person_id: personMap.get('james-tavares'), mention_type: 'quoted' },
    { article_id: articleMap.get('Mauna Kea Alliance Wins Legal Battle on Access Road'), person_id: personMap.get('haunani-pukui'), mention_type: 'subject' },
    { article_id: articleMap.get('Mauna Kea Alliance Wins Legal Battle on Access Road'), organization_id: orgMap.get('mauna-kea-conservation-alliance'), mention_type: 'subject' },
    { article_id: articleMap.get('PUC Commissioner\'s Former Employer Now Before the Commission'), person_id: personMap.get('david-chung'), mention_type: 'investigated' },
    { article_id: articleMap.get('PUC Commissioner\'s Former Employer Now Before the Commission'), organization_id: orgMap.get('hawaii-energy-cooperative'), mention_type: 'mentioned' },
    { article_id: articleMap.get('Kaeo Champions Teacher Pay Raise in House Floor Speech'), person_id: personMap.get('leilani-kaeo'), mention_type: 'subject' },
    { article_id: articleMap.get('Affordable Housing Crisis: Who Benefits From the Status Quo?'), person_id: personMap.get('sarah-lindgren'), mention_type: 'investigated' },
    { article_id: articleMap.get('Affordable Housing Crisis: Who Benefits From the Status Quo?'), person_id: personMap.get('marcus-wong'), mention_type: 'mentioned' },
  ]

  const { error: mentionError } = await supabase.from('article_entity_mention').insert(mentions)
  if (mentionError) console.error('Mentions error:', mentionError)
  else console.log(`Inserted ${mentions.length} article mentions`)

  // --- TIMELINE EVENTS ---
  const timelineEvents = [
    { person_id: personMap.get('keoni-nakamura'), event_date: '2018-11-06', event_type: 'elected', title: 'Elected to State Senate', description: 'Won District 13 seat in general election.' },
    { person_id: personMap.get('keoni-nakamura'), event_date: '2024-01-20', event_type: 'legislation_passed', title: 'Introduced Renewable Energy Mandate Bill', description: 'SB 1234 proposes 100% renewable energy by 2040.' },
    { person_id: personMap.get('leilani-kaeo'), event_date: '2022-11-08', event_type: 'elected', title: 'Elected to State House', description: 'Won District 44 seat representing central Maui.' },
    { person_id: personMap.get('david-chung'), event_date: '2022-06-15', event_type: 'appointed', title: 'Appointed PUC Commissioner', description: 'Appointed by the Governor to serve on the Public Utilities Commission.' },
    { person_id: personMap.get('david-chung'), event_date: '2022-01-01', event_type: 'left_board', title: 'Departed Hawaii Energy Cooperative', description: 'Left senior consultant role prior to PUC appointment.' },
    { person_id: personMap.get('sarah-lindgren'), event_date: '2019-03-01', event_type: 'founded_org', title: 'Became CEO of Pacific Horizons', description: 'Promoted to CEO after serving as COO.' },
    { person_id: personMap.get('sarah-lindgren'), event_date: '2024-05-10', event_type: 'investigation_opened', title: 'Developer Donations Under Scrutiny', description: 'Hoku.fm reports on pattern of donations to housing committee members.' },
    { person_id: personMap.get('robert-kalani'), event_date: '2024-11-05', event_type: 'elected', title: 'Elected Mayor of Hawaii County', description: 'Won mayoral race on sustainability platform.' },
    { person_id: personMap.get('haunani-pukui'), event_date: '2024-03-15', event_type: 'achievement', title: 'Won Legal Battle on Mauna Kea Access', description: 'Court rules in favor of conservation alliance.' },
    { person_id: personMap.get('james-tavares'), event_date: '2019-09-01', event_type: 'elected', title: 'Elected ILWU Local 142 President', description: 'Won union leadership election.' },
    { organization_id: orgMap.get('hawaii-energy-cooperative'), event_date: '2024-03-15', event_type: 'puc_decision', title: 'Filed Rate Increase Application', description: 'HEC files Docket 2024-0158 requesting 12% rate increase.' },
    { organization_id: orgMap.get('mauna-kea-conservation-alliance'), event_date: '2024-03-15', event_type: 'achievement', title: 'Legal Victory on Access Road', description: 'Court rules against proposed development near Mauna Kea.' },
    { person_id: personMap.get('marcus-wong'), event_date: '2024-02-15', event_type: 'investigation_opened', title: 'Lobbying Connections Investigated', description: 'Hoku.fm publishes investigation into energy lobbying network.' },
    { person_id: personMap.get('amy-takeshita'), event_date: '2023-01-15', event_type: 'joined_board', title: 'Registered as Healthcare Lobbyist', description: 'Filed lobbyist registration for healthcare clients.' },
    { person_id: personMap.get('patricia-medeiros'), event_date: '2023-06-01', event_type: 'achievement', title: 'Joined Hoku.fm', description: 'Hired as investigative editor.' },
    { organization_id: orgMap.get('hawaii-puc'), event_date: '2024-06-01', event_type: 'investigation_opened', title: 'Launched RPS Compliance Investigation', description: 'PUC opens investigation into utility compliance with renewable portfolio standards.' },
    { person_id: personMap.get('leilani-kaeo'), event_date: '2024-04-25', event_type: 'legislation_passed', title: 'Teacher Pay Raise Floor Speech', description: 'Delivered landmark speech on education funding bill.' },
    { person_id: personMap.get('keoni-nakamura'), event_date: '2022-11-08', event_type: 'elected', title: 'Re-elected to State Senate', description: 'Won second term in District 13.' },
    { organization_id: orgMap.get('ilwu-local-142'), event_date: '2024-07-01', event_type: 'endorsed', title: 'Endorsed Kalani for Mayor', description: 'Union endorses Robert Kalani in Hawaii County mayoral race.' },
    { person_id: personMap.get('robert-kalani'), event_date: '2020-12-31', event_type: 'left_board', title: 'Left Mauna Kea Conservation Alliance Board', description: 'Stepped down as board chair to prepare for mayoral campaign.' },
  ]

  const { error: timelineError } = await supabase.from('timeline_event').insert(timelineEvents)
  if (timelineError) console.error('Timeline error:', timelineError)
  else console.log(`Inserted ${timelineEvents.length} timeline events`)

  // --- LOBBYING ---
  const lobbyRegistrations = [
    { lobbyist_person_id: personMap.get('marcus-wong'), lobbying_firm_org_id: orgMap.get('pacific-policy-group'), client_org_id: orgMap.get('hawaii-energy-cooperative'), client_name_raw: 'Hawaii Energy Cooperative', registration_period: '2023-2024', issues: ['energy rates', 'renewable energy', 'grid modernization'] },
    { lobbyist_person_id: personMap.get('marcus-wong'), lobbying_firm_org_id: orgMap.get('pacific-policy-group'), client_org_id: orgMap.get('pacific-horizons-development'), client_name_raw: 'Pacific Horizons Development', registration_period: '2023-2024', issues: ['housing', 'zoning', 'permitting'] },
    { lobbyist_person_id: personMap.get('amy-takeshita'), lobbying_firm_org_id: orgMap.get('chang-associates'), client_name_raw: 'Hawaii Medical Association', registration_period: '2023-2024', issues: ['healthcare', 'telehealth', 'insurance'] },
  ]

  const { error: lobbyError } = await supabase.from('lobbyist_registration').insert(lobbyRegistrations)
  if (lobbyError) console.error('Lobbying error:', lobbyError)
  else console.log(`Inserted ${lobbyRegistrations.length} lobbyist registrations`)

  // --- FINANCIAL DISCLOSURES ---
  const disclosures = [
    { person_id: personMap.get('keoni-nakamura'), filing_year: 2024, position_held: 'State Senator', financial_interests: { income_sources: ['State of Hawaii - Senator salary'], assets: ['Residential property, Kaneohe'], liabilities: ['Mortgage, First Hawaiian Bank'], business_interests: [], real_property: ['123 Kaneohe St, Kaneohe, HI'] } },
    { person_id: personMap.get('david-chung'), filing_year: 2024, position_held: 'PUC Commissioner', financial_interests: { income_sources: ['State of Hawaii - Commissioner salary'], assets: ['401k retirement account', 'Residential property, Honolulu'], liabilities: ['Mortgage, Bank of Hawaii'], business_interests: ['Former consultant, Hawaii Energy Cooperative (divested)'], real_property: ['456 Kapiolani Blvd, Honolulu, HI'] } },
  ]

  const { error: disclosureError } = await supabase.from('financial_disclosure').insert(disclosures)
  if (disclosureError) console.error('Disclosures error:', disclosureError)
  else console.log(`Inserted ${disclosures.length} financial disclosures`)

  console.log('\nSeed complete!')
}

seed().catch(console.error)
