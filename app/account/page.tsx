import Link from 'next/link'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { Badge } from '@/components/ui/Badge'
import { buttonClass } from '@/components/ui/Button'
import { SignOutButton } from '@/components/account/SignOutButton'
import { formatDate } from '@/lib/format'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Account' }

export default async function AccountPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/auth/login?next=/account')

  const { account } = user
  const { entitlements } = user
  const isFree = entitlements.tier === 'free' && !entitlements.is_staff

  return (
    <>
      <Header signedIn />
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 sm:px-6 py-16">
        <h1 className="text-3xl font-bold mb-8">Account</h1>

        <section className="border border-rule p-6 mb-6">
          <h2 className="text-xs font-bold uppercase tracking-wide mb-4">Profile</h2>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted">Email</dt>
            <dd data-ph-mask>{user.email}</dd>
            {user.name && (<><dt className="text-muted">Name</dt><dd data-ph-mask>{user.name}</dd></>)}
            {user.isStaff && (<><dt className="text-muted">Role</dt><dd><Badge variant="solid">Staff</Badge> <Link href="/admin" className="ml-2">Admin</Link></dd></>)}
          </dl>
        </section>

        <section className="border border-rule p-6 mb-6">
          <h2 className="text-xs font-bold uppercase tracking-wide mb-4">Subscription</h2>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted">Plan</dt>
            <dd className="font-bold capitalize">{entitlements.tier}</dd>
            <dt className="text-muted">Status</dt>
            <dd className="capitalize">{account.subscription_status}</dd>
            {account.trial_ends_at && (<><dt className="text-muted">Trial ends</dt><dd>{formatDate(account.trial_ends_at)}</dd></>)}
            <dt className="text-muted">Member since</dt>
            <dd>{formatDate(account.created_at)}</dd>
          </dl>
          {isFree && (
            <Link href="/pricing" className={`${buttonClass('primary', 'sm')} mt-5`}>Upgrade</Link>
          )}
          {!isFree && (
            <p className="mt-5 text-sm text-muted">To change or cancel your plan, email <a href="mailto:constellation@hoku.fm">constellation@hoku.fm</a>.</p>
          )}
        </section>

        <SignOutButton />
      </main>
      <Footer />
    </>
  )
}
