import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authenticateApiRequest } from '../../../_lib/auth'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await authenticateApiRequest()
  if (error) return error

  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from('puc_participant')
    .select('role, docket:docket_id(id, docket_number, title, docket_type, status, filed_date, decision_date, utility_type)')
    .eq('organization_id', id)

  return NextResponse.json({ data: data || [] })
}
