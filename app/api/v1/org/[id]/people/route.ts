import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authenticateApiRequest } from '../../../_lib/auth'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await authenticateApiRequest()
  if (error) return error

  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from('relationship')
    .select(`*, source_person:source_person_id(id, full_name, slug, entity_types), target_person:target_person_id(id, full_name, slug, entity_types)`)
    .or(`source_org_id.eq.${id},target_org_id.eq.${id}`)

  return NextResponse.json({ data: data || [] })
}
