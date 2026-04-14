import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { importFECFull } from '@/lib/import/sources/fec'

export const maxDuration = 55

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  // Check if already run today
  const { data: cursor } = await supabase
    .from('import_cursor')
    .select('*')
    .eq('source', 'fec')
    .single()

  if (cursor) {
    const lastRun = cursor.last_run_at ? new Date(cursor.last_run_at) : null
    const today = new Date().toISOString().split('T')[0]
    if (lastRun?.toISOString().split('T')[0] === today && cursor.status === 'complete') {
      return NextResponse.json({ message: 'Already complete for today', status: 'complete' })
    }
  }

  await supabase.from('import_cursor').upsert({
    source: 'fec',
    status: 'running',
    last_run_at: new Date().toISOString(),
  })

  try {
    const result = await importFECFull()

    await supabase.from('import_cursor').upsert({
      source: 'fec',
      status: 'complete',
      last_run_at: new Date().toISOString(),
      metadata: { inserted: result.inserted, candidates: result.candidates },
    })

    return NextResponse.json({ status: 'complete', ...result })
  } catch (e) {
    await supabase.from('import_cursor').upsert({
      source: 'fec',
      status: 'idle',
      last_run_at: new Date().toISOString(),
      metadata: { error: e instanceof Error ? e.message : 'Unknown error' },
    })

    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 })
  }
}
