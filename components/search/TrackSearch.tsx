'use client'

import { useEffect } from 'react'
import { track, EVENTS } from '@/lib/analytics-events'

/** Fires search_performed once per query/result change. Never sends the query text itself. */
export function TrackSearch({ queryLength, resultCount, kind }: { queryLength: number; resultCount: number; kind?: string }) {
  useEffect(() => {
    if (queryLength === 0) return
    track(EVENTS.SEARCH_PERFORMED, { query_length: queryLength, result_count: resultCount, kind })
  }, [queryLength, resultCount, kind])
  return null
}
