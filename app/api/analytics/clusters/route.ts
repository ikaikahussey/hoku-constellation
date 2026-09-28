import { NextResponse } from 'next/server'
import { authenticateSubscriber } from '../_lib/auth'

export async function GET() {
  const { error, db } = await authenticateSubscriber()
  if (error) return error
  const data = await db.one(`select snapshot_date, node_count, edge_count, metrics from ax_graph_snapshot order by snapshot_date desc limit 1`)
  return NextResponse.json(data ?? null)
}
