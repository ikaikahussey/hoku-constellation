import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { importCSCBatch } from '@/lib/import/sources/csc'

export const maxDuration = 55

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  // Get or create cursor
  const { data: cursor } = await supabase
    .from('import_cursor')
    .select('*')
    .eq('source', 'hawaii_csc')
    .single()

  let offset = 0

  if (cursor) {
    // Reset cursor if last run was on a different day
    const lastRun = cursor.last_run_at ? new Date(cursor.last_run_at) : null
    const today = new Date().toISOString().split('T')[0]
    const lastRunDay = lastRun?.toISOString().split('T')[0]

    if (lastRunDay === today && cursor.status === 'complete') {
      return NextResponse.json({ message: 'Already complete for today', status: 'complete' })
    }

    if (lastRunDay !== today) {
      // New day — reset offset
      offset = 0
    } else {
      offset = cursor.cursor_offset || 0
    }
  }

  // Update status to running
  await supabase
    .from('import_cursor')
    .upsert({
      source: 'hawaii_csc',
      cursor_offset: offset,
      status: 'running',
      last_run_at: new Date().toISOString(),
    })

  try {
    const result = await importCSCBatch(offset, 2000)

    const newStatus = result.done ? 'complete' : 'running'
    await supabase
      .from('import_cursor')
      .upsert({
        source: 'hawaii_csc',
        cursor_offset: result.nextOffset,
        status: newStatus,
        last_run_at: new Date().toISOString(),
        metadata: { last_inserted: result.inserted, last_persons_created: result.personsCreated },
      })

    return NextResponse.json({
      status: newStatus,
      offset: result.nextOffset,
      inserted: result.inserted,
      personsCreated: result.personsCreated,
      done: result.done,
    })
  } catch (e) {
    await supabase
      .from('import_cursor')
      .upsert({
        source: 'hawaii_csc',
        cursor_offset: offset,
        status: 'idle',
        last_run_at: new Date().toISOString(),
        metadata: { error: e instanceof Error ? e.message : 'Unknown error' },
      })

    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
