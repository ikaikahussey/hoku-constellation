'use client'

import { useEffect } from 'react'
import { track, EVENTS } from '@/lib/analytics-events'

export function TrackEntityView({ kind, id, gateHit }: { kind: string; id: string; gateHit: boolean }) {
  useEffect(() => {
    track(EVENTS.ENTITY_VIEWED, { kind, entity_id: id, gate_hit: gateHit })
  }, [kind, id, gateHit])
  return null
}
