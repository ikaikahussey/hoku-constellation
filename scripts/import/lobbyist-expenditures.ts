/**
 * Lobbyist Expenditure Import Script
 * Input: CSV from Hawaii State Ethics Commission
 * Usage: npx tsx scripts/import/lobbyist-expenditures.ts <csv-file-path>
 */
import { createClient } from '@supabase/supabase-js'
import { parseCSV } from './utils/csv-parser'
import { EntityMatcher } from './utils/entity-matcher'
import { ImportLogger } from './utils/logger'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function importLobbyistExpenditures(filePath: string) {
  const logger = new ImportLogger('Lobbyist Expenditures')
  const matcher = new EntityMatcher()
  await matcher.load(supabase)

  const records = parseCSV(filePath)
  console.log(`Parsed ${records.length} records from ${filePath}`)

  for (const row of records) {
    const lobbyistName = row['Lobbyist Name'] || row['lobbyist_name'] || ''
    const clientName = row['Client Name'] || row['client'] || ''
    const amount = parseFloat(row['Amount'] || row['amount'] || '0')
    const period = row['Period'] || row['period'] || ''
    const expenditureType = row['Expenditure Type'] || row['type'] || ''

    if (!lobbyistName || isNaN(amount)) {
      logger.recordError('Missing required fields')
      continue
    }

    const lobbyistMatch = matcher.matchPerson(lobbyistName)
    const clientMatch = clientName ? matcher.matchOrg(clientName) : null

    const record = {
      lobbyist_person_id: lobbyistMatch?.id || null,
      client_org_id: clientMatch?.id || null,
      amount,
      period: period || null,
      expenditure_type: expenditureType || null,
      raw_record: row,
    }

    const { error } = await supabase.from('lobbyist_expenditure').insert(record)
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
  console.error('Usage: npx tsx scripts/import/lobbyist-expenditures.ts <csv-file-path>')
  process.exit(1)
}
importLobbyistExpenditures(filePath).catch(console.error)
