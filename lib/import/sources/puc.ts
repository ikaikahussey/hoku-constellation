import { createAdminClient } from '@/lib/supabase/admin'

const KNOWN_DOCKETS = [
  { docket_number: '2022-0212', title: 'Integrated Grid Planning Report', status: 'active', filing_date: '2022-10-15', utility: 'Hawaiian Electric', description: 'Review of integrated grid planning for renewable energy transition' },
  { docket_number: '2023-0089', title: 'DER Program Review', status: 'active', filing_date: '2023-05-10', utility: 'Hawaiian Electric', description: 'Distributed Energy Resources interconnection program evaluation' },
  { docket_number: '2018-0088', title: 'Performance Based Regulation', status: 'active', filing_date: '2018-04-18', utility: 'Hawaiian Electric', description: 'Framework for performance-based regulation of electric utilities' },
  { docket_number: '2022-0165', title: 'Emergency Preparedness', status: 'active', filing_date: '2022-08-01', utility: 'Hawaiian Electric', description: 'Emergency and wildfire preparedness standards and protocols' },
  { docket_number: '2023-0141', title: 'Community Based Renewable Energy', status: 'active', filing_date: '2023-08-22', utility: 'Hawaiian Electric', description: 'Community-Based Renewable Energy program modifications' },
  { docket_number: '2019-0323', title: 'Stage 2 Grid Modernization', status: 'active', filing_date: '2019-10-30', utility: 'Hawaiian Electric', description: 'Grid modernization strategy stage 2 approval' },
]

export async function importPUCFull(): Promise<{ inserted: number; note: string }> {
  const supabase = createAdminClient()

  let inserted = 0
  for (const d of KNOWN_DOCKETS) {
    const { error } = await supabase.from('puc_docket').upsert(d, { onConflict: 'docket_number' })
    if (!error) inserted++
  }

  return { inserted, note: 'PUC has no public API — inserted known major dockets' }
}
