/**
 * Financial Disclosure Import Script
 * Input: CSV from Hawaii State Ethics Commission
 * Usage: npx tsx scripts/import/financial-disclosures.ts <csv-file-path>
 */
import { createClient } from '@supabase/supabase-js'
import { parseCSV } from './utils/csv-parser'
import { EntityMatcher } from './utils/entity-matcher'
import { ImportLogger } from './utils/logger'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function importFinancialDisclosures(filePath: string) {
  const logger = new ImportLogger('Financial Disclosures')
  const matcher = new EntityMatcher()
  await matcher.load(supabase)

  const records = parseCSV(filePath)
  console.log(`Parsed ${records.length} records from ${filePath}`)

  for (const row of records) {
    const personName = row['Name'] || row['Filer Name'] || row['person_name'] || ''
    const filingYear = parseInt(row['Filing Year'] || row['Year'] || '0')
    const position = row['Position'] || row['Title'] || ''

    if (!personName || !filingYear) {
      logger.recordError('Missing person name or filing year')
      continue
    }

    const personMatch = matcher.matchPerson(personName)

    // Parse financial interest fields
    const financialInterests = {
      income_sources: splitField(row['Income Sources'] || row['income_sources']),
      assets: splitField(row['Assets'] || row['assets']),
      liabilities: splitField(row['Liabilities'] || row['liabilities']),
      business_interests: splitField(row['Business Interests'] || row['business_interests']),
      real_property: splitField(row['Real Property'] || row['real_property']),
    }

    const record = {
      person_id: personMatch?.id || null,
      filing_year: filingYear,
      position_held: position || null,
      financial_interests: financialInterests,
      source_url: row['Source URL'] || null,
      raw_record: row,
    }

    const { error } = await supabase.from('financial_disclosure').insert(record)
    if (error) {
      logger.recordError(error.message)
    } else {
      logger.recordInsert()
      if (personMatch) logger.recordMatch()
      else logger.recordUnmatched()
    }
  }

  return logger.summary()
}

function splitField(val: string | undefined): string[] {
  if (!val) return []
  return val.split(/[;|]/).map(s => s.trim()).filter(Boolean)
}

const filePath = process.argv[2]
if (!filePath) {
  console.error('Usage: npx tsx scripts/import/financial-disclosures.ts <csv-file-path>')
  process.exit(1)
}
importFinancialDisclosures(filePath).catch(console.error)
