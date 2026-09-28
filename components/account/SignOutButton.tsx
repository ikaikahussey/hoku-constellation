'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { getAuthClient } from '@/lib/db/browser'
import { resetAnalytics } from '@/lib/analytics-events'

export function SignOutButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleSignOut() {
    setLoading(true)
    try {
      await getAuthClient().signOut()
    } finally {
      resetAnalytics()
      router.push('/')
      router.refresh()
    }
  }

  return <Button variant="secondary" size="sm" onClick={handleSignOut} loading={loading}>Sign out</Button>
}
