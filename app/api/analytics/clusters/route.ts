import { NextResponse } from 'next/server'
import { authenticateSubscriber } from '../_lib/auth'

export async function GET() {
  const { error, supabase } = await authenticateSubscriber()
  if (error) return error
  const { data } = await supabase
    .from('ax_graph_snapshot')
    .select('snapshot_date, node_count, edge_count, metrics')
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  return NextResponse.json(data ?? null)
}
