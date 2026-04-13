/**
 * Campaign Finance Import Script
 * Input: CSV from Hawaii Campaign Spending Commission
 * Usage: npx tsx scripts/import/campaign-finance.ts <csv-file-path>
 */
import { createClient } from '@supabase/supabase-js'
import { parseCSV } from './utils/csv-parser'
import { EntityMatcher } from './utils/entity-matcher'
import { ImportLogger } from './utils/logger'
import { createHash } from 'crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function importCampaignFinance(filePath: string) {
  const logger = new ImportLogger('Campaign Finance')
  const matcher = new EntityMatcher()
  await matcher.load(supabase)

  const records = parseCSV(filePath)
  console.log(`Parsed ${records.length} records from ${filePath}`)

  for (const row of records) {
    // Generate hash for idempotent imports
    const rawJson = JSON.stringify(row)
    const hash = createHash('md5').update(rawJson).digest('hex')

    // Check for duplicate
    const { data: existing } = await supabase
      .from('contribution')
      .select('id')
      .eq('source_file', filePath)
      .contains('raw_record', { _hash: hash })
      .limit(1)

    if (existing && existing.length > 0) {
      logger.recordSkip()
      continue
    }

    // Map CSV fields (adapt these to actual CSC column names)
    const donorName = row['Contributor Name'] || row['donor_name'] || row['Name'] || ''
    const recipientName = row['Candidate Name'] || row['recipient_name'] || row['Committee'] || ''
    const amount = parseFloat(row['Amount'] || row['amount'] || '0')
    const dateStr = row['Date'] || row['contribution_date'] || row['Received Date'] || ''
    const electionPeriod = row['Election Period'] || row['election_period'] || ''
    const contribType = row['Contributor Type'] || row['contribution_type'] || ''

    if (!donorName || !recipientName || isNaN(amount)) {
      logger.recordError(`Invalid record: ${donorName} -> ${recipientName}`)
      continue
    }

    // Match donor
    const donorMatch = matcher.matchAny(donorName)
    // Match recipient
    const recipientMatch = matcher.matchAny(recipientName)

    const record = {
      donor_name_raw: donorName,
      recipient_name_raw: recipientName,
      donor_person_id: donorMatch?.type === 'person' ? donorMatch.id : null,
      donor_org_id: donorMatch?.type === 'organization' ? donorMatch.id : null,
      recipient_person_id: recipientMatch?.type === 'person' ? recipientMatch.id : null,
      recipient_org_id: recipientMatch?.type === 'organization' ? recipientMatch.id : null,
      match_confidence: donorMatch ? donorMatch.confidence : null,
      match_status: donorMatch ? donorMatch.status : 'unmatched',
      amount,
      contribution_date: dateStr || null,
      election_period: electionPeriod || null,
      contribution_type: mapContribType(contribType),
      source: 'state_csc' as const,
      raw_record: { ...row, _hash: hash },
      source_file: filePath,
    }

    const { error } = await supabase.from('contribution').insert(record)
    if (error) {
      logger.recordError(error.message)
    } else {
      logger.recordInsert()
      if (donorMatch) logger.recordMatch()
      else logger.recordUnmatched()
    }
  }

  return logger.summary()
}

function mapContribType(raw: string): string {
  const lower = raw.toLowerCase()
  if (lower.includes('individual')) return 'individual'
  if (lower.includes('corporate') || lower.includes('business')) return 'corporate'
  if (lower.includes('pac') || lower.includes('committee')) return 'pac'
  if (lower.includes('self') || lower.includes('candidate')) return 'self'
  return 'other'
}

// CLI entry
const filePath = process.argv[2]
if (!filePath) {
  console.error('Usage: npx tsx scripts/import/campaign-finance.ts <csv-file-path>')
  process.exit(1)
}
importCampaignFinance(filePath).catch(console.error)
