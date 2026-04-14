import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { importPUCFull } from '@/lib/import/sources/puc'

export const maxDuration = 55

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  await supabase.from('import_cursor').upsert({
    source: 'puc',
    status: 'running',
    last_run_at: new Date().toISOString(),
  })

  try {
    const result = await importPUCFull()

    await supabase.from('import_cursor').upsert({
      source: 'puc',
      status: 'complete',
      last_run_at: new Date().toISOString(),
      metadata: { inserted: result.inserted },
    })

    return NextResponse.json({ status: 'complete', ...result })
  } catch (e) {
    await supabase.from('import_cursor').upsert({
      source: 'puc',
      status: 'idle',
      last_run_at: new Date().toISOString(),
      metadata: { error: e instanceof Error ? e.message : 'Unknown error' },
    })

    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 })
  }
}
