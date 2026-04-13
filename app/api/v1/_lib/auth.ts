import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function authenticateApiRequest(): Promise<{
  error: NextResponse | null
  userId: string | null
  tier: string | null
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return {
      error: NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
      userId: null,
      tier: null,
    }
  }

  const { data: profile } = await supabase
    .from('user_profile')
    .select('subscription_tier, subscription_status')
    .eq('id', user.id)
    .single()

  if (!profile ||
    !['professional', 'institutional'].includes(profile.subscription_tier) ||
    !['active', 'trialing'].includes(profile.subscription_status)
  ) {
    return {
      error: NextResponse.json(
        { error: 'API access requires a Professional or Institutional subscription' },
        { status: 403 }
      ),
      userId: user.id,
      tier: profile?.subscription_tier || 'free',
    }
  }

  return { error: null, userId: user.id, tier: profile.subscription_tier }
}

export function paginationParams(searchParams: URLSearchParams) {
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100)
  const offset = parseInt(searchParams.get('offset') || '0')
  return { limit, offset }
}

export function csvResponse(data: Record<string, unknown>[], filename: string) {
  if (data.length === 0) return NextResponse.json([])
  const headers = Object.keys(data[0])
  const csv = [
    headers.join(','),
    ...data.map(row => headers.map(h => {
      const val = String(row[h] ?? '')
      return val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val
    }).join(',')),
  ].join('\n')

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
