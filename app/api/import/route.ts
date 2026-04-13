import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parse } from 'csv-parse/sync'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const source = formData.get('source') as string | null

  if (!file || !source) {
    return NextResponse.json({ error: 'File and source are required' }, { status: 400 })
  }

  const text = await file.text()
  const records: Record<string, string>[] = parse(text, { columns: true, skip_empty_lines: true, trim: true })
  const supabase = createAdminClient()

  let inserted = 0
  let skipped = 0
  let matched = 0
  let unmatched = 0

  if (source === 'state_csc' || source === 'federal_fec' || source.startsWith('county_')) {
    for (const row of records) {
      const donorName = row['Contributor Name'] || row['donor_name'] || row['Name'] || ''
      const recipientName = row['Candidate Name'] || row['recipient_name'] || ''
      const amount = parseFloat(row['Amount'] || row['amount'] || '0')

      if (!donorName || !recipientName || isNaN(amount)) { skipped++; continue }

      const { error } = await supabase.from('contribution').insert({
        donor_name_raw: donorName,
        recipient_name_raw: recipientName,
        amount,
        contribution_date: row['Date'] || row['contribution_date'] || null,
        election_period: row['Election Period'] || null,
        contribution_type: 'other',
        source,
        match_status: 'unmatched',
        raw_record: row,
        source_file: file.name,
      })

      if (error) skipped++
      else { inserted++; unmatched++ }
    }
  } else if (source === 'ethics_lobbyist_reg') {
    for (const row of records) {
      const { error } = await supabase.from('lobbyist_registration').insert({
        client_name_raw: row['Client Name'] || row['client'] || '',
        registration_period: row['Period'] || null,
        issues: (row['Issues'] || '').split(';').map((s: string) => s.trim()).filter(Boolean),
        raw_record: row,
      })
      if (error) skipped++
      else { inserted++; unmatched++ }
    }
  } else if (source === 'ethics_lobbyist_exp') {
    for (const row of records) {
      const amount = parseFloat(row['Amount'] || row['amount'] || '0')
      const { error } = await supabase.from('lobbyist_expenditure').insert({
        amount: isNaN(amount) ? 0 : amount,
        period: row['Period'] || null,
        expenditure_type: row['Type'] || null,
        raw_record: row,
      })
      if (error) skipped++
      else { inserted++; unmatched++ }
    }
  } else if (source === 'ethics_disclosure') {
    for (const row of records) {
      const { error } = await supabase.from('financial_disclosure').insert({
        filing_year: parseInt(row['Year'] || '0'),
        position_held: row['Position'] || null,
        financial_interests: {},
        raw_record: row,
      })
      if (error) skipped++
      else { inserted++; unmatched++ }
    }
  }

  return NextResponse.json({ inserted, skipped, matched, unmatched })
}
