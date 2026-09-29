import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getCurrentUser } from '@/lib/auth'
import { getServiceDb } from '@/lib/db/service'
import { acceptInvitation, hashToken, TeamError } from '@/lib/teams'
import { TEAM_COOKIE } from '@/lib/workspace'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { buttonClass } from '@/components/ui/Button'

export const metadata: Metadata = { title: 'Team invitation', robots: { index: false } }

interface Props { params: Promise<{ token: string }> }

async function accept(fd: FormData) {
  'use server'
  const token = String(fd.get('token') ?? '')
  const user = await getCurrentUser()
  if (!user) redirect(`/auth/login?next=${encodeURIComponent(`/invite/${token}`)}`)
  let teamId: string
  try {
    teamId = (await acceptInvitation(await getServiceDb(), token, user.id, user.email)).teamId
  } catch (e) {
    redirect(`/invite/${token}?error=${encodeURIComponent(e instanceof TeamError ? e.message : 'Could not accept the invitation')}`)
  }
  ;(await cookies()).set(TEAM_COOKIE, teamId, { httpOnly: true, sameSite: 'lax', path: '/' })
  redirect('/workspace')
}

export default async function InvitePage({ params, searchParams }: Props & { searchParams: Promise<{ error?: string }> }) {
  const { token } = await params
  const { error } = await searchParams
  const db = await getServiceDb()
  const inv = await db.one<{ team: string; email: string; role: string }>(
    `select t.name team, i.email, i.role from app.invitation i join app.team t on t.id = i.team_id
      where i.token_hash = $1 and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()`, [hashToken(token)])
  const user = await getCurrentUser()
  return (
    <>
      <Header signedIn={!!user} />
      <main className="flex-1 max-w-xl mx-auto w-full px-4 py-16">
        {!inv ? (<><h1 className="text-3xl font-bold mb-4">Invitation not valid</h1><p>This invitation has expired, was revoked, or was already used. Ask the team owner for a new one.</p></>) : (
          <>
            <h1 className="text-3xl font-bold mb-4">Join {inv.team}</h1>
            <p className="mb-6">You were invited as {inv.role === 'admin' ? 'an admin' : 'a member'} (<span data-ph-mask>{inv.email}</span>).</p>
            {error && <p role="alert" className="mb-4">⚠ {error}</p>}
            {user ? (
              <form action={accept}><input type="hidden" name="token" value={token} /><button type="submit" className={buttonClass('primary')}>Accept invitation</button></form>
            ) : (
              <p className="flex gap-4"><Link href={`/auth/signup?next=${encodeURIComponent(`/invite/${token}`)}`} className={buttonClass('primary')}>Create an account</Link>
                <Link href={`/auth/login?next=${encodeURIComponent(`/invite/${token}`)}`} className={buttonClass('secondary')}>Log in</Link></p>
            )}
          </>
        )}
      </main>
      <Footer />
    </>
  )
}
