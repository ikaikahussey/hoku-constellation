/**
 * Lobbyist Registration Import Script
 * Input: CSV from Hawaii State Ethics Commission
 * Usage: npx tsx scripts/import/lobbyist-registrations.ts <csv-file-path>
 */
import { createClient } from '@supabase/supabase-js'
import { parseCSV } from './utils/csv-parser'
import { EntityMatcher } from './utils/entity-matcher'
import { ImportLogger } from './utils/logger'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function importLobbyistRegistrations(filePath: string) {
  const logger = new ImportLogger('Lobbyist Registrations')
  const matcher = new EntityMatcher()
  await matcher.load(supabase)

  const records = parseCSV(filePath)
  console.log(`Parsed ${records.length} records from ${filePath}`)

  for (const row of records) {
    const lobbyistName = row['Lobbyist Name'] || row['lobbyist_name'] || ''
    const firmName = row['Firm Name'] || row['firm'] || ''
    const clientName = row['Client Name'] || row['client'] || ''
    const period = row['Registration Period'] || row['period'] || ''
    const issues = (row['Issues'] || row['Subject Areas'] || '').split(/[;,]/).map((s: string) => s.trim()).filter(Boolean)

    if (!lobbyistName) {
      logger.recordError('Missing lobbyist name')
      continue
    }

    const lobbyistMatch = matcher.matchPerson(lobbyistName)
    const firmMatch = firmName ? matcher.matchOrg(firmName) : null
    const clientMatch = clientName ? matcher.matchOrg(clientName) : null

    const record = {
      lobbyist_person_id: lobbyistMatch?.id || null,
      lobbying_firm_org_id: firmMatch?.id || null,
      client_org_id: clientMatch?.id || null,
      client_name_raw: clientName,
      registration_period: period || null,
      issues,
      source_url: row['Source URL'] || null,
      raw_record: row,
    }

    const { error } = await supabase.from('lobbyist_registration').insert(record)
    if (error) {
      logger.recordError(error.message)
    } else {
      logger.recordInsert()
      if (lobbyistMatch) logger.recordMatch()
      else logger.recordUnmatched()
    }
  }

  return logger.summary()
}

const filePath = process.argv[2]
if (!filePath) {
  console.error('Usage: npx tsx scripts/import/lobbyist-registrations.ts <csv-file-path>')
  process.exit(1)
}
importLobbyistRegistrations(filePath).catch(console.error)
