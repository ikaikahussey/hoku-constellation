'use client'

import { useEffect } from 'react'
import { EVENTS, track } from '@/lib/analytics-events'

export function TrackBriefing({ kind }: { kind: string }) {
  useEffect(() => { track(EVENTS.BRIEFING_VIEWED, { kind }) }, [kind])
  return null
}
