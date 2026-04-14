import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Compute a SHA-256 checksum of an arbitrary serializable object. */
export function sha256(value: unknown): string {
  const json = typeof value === 'string' ? value : JSON.stringify(value)
  return createHash('sha256').update(json).digest('hex')
}

/**
 * Insert a raw record into data_source_record, keyed by SHA-256 checksum.
 * Returns { inserted: true } on new insert, { inserted: false } if duplicate.
 * Duplicate detection uses the unique index on checksum.
 */
export async function insertSourceRecord(
  supabase: SupabaseClient,
  opts: {
    source_id: string
    source_name: string
    raw_data: unknown
  }
): Promise<{ inserted: boolean; checksum: string; error?: string }> {
  const checksum = sha256(opts.raw_data)
  const { error } = await supabase.from('data_source_record').insert({
    source_id: opts.source_id,
    source_name: opts.source_name,
    raw_data: opts.raw_data as object,
    checksum,
  })
  if (error) {
    // unique violation → already seen
    if (error.code === '23505' || /duplicate key/i.test(error.message)) {
      return { inserted: false, checksum }
    }
    return { inserted: false, checksum, error: error.message }
  }
  return { inserted: true, checksum }
}

/** Check if a checksum already exists in data_source_record. */
export async function recordExists(
  supabase: SupabaseClient,
  checksum: string
): Promise<boolean> {
  const { data } = await supabase
    .from('data_source_record')
    .select('id')
    .eq('checksum', checksum)
    .limit(1)
    .maybeSingle()
  return !!data
}

/** Update import_cursor for a source. */
export async function updateCursor(
  supabase: SupabaseClient,
  source: string,
  cursor_offset: number,
  status: 'running' | 'complete' | 'idle',
  metadata?: Record<string, unknown>
) {
  await supabase.from('import_cursor').upsert({
    source,
    cursor_offset,
    status,
    last_run_at: new Date().toISOString(),
    metadata: metadata ?? {},
  })
}
