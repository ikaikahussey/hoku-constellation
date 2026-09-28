'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { getAuthClient } from '@/lib/db/browser'
import { AuthShell, FormError } from '@/components/auth/AuthShell'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

function SignupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const plan = searchParams.get('plan')
  const next = plan ? `/pricing?plan=${encodeURIComponent(plan)}` : '/search'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [pendingVerification, setPendingVerification] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { data, error } = await getAuthClient().signUp.email({ email, password, name })
    if (error) {
      setError(error.message ?? 'Could not create your account.')
      setLoading(false)
      return
    }
    const token = (data as { token?: string | null } | null)?.token
    if (token) {
      router.push(next)
      router.refresh()
      return
    }
    setPendingVerification(true)
    setLoading(false)
  }

  async function handleGoogle() {
    setError('')
    const callbackURL = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
    const { error } = await getAuthClient().signIn.social({ provider: 'google', callbackURL })
    if (error) setError(error.message ?? 'Google sign-in failed.')
  }

  if (pendingVerification) {
    return (
      <div className="text-center">
        <p className="text-muted">We sent a confirmation link to <strong className="text-ink" data-ph-mask>{email}</strong>. Open it to finish creating your account.</p>
        <p className="mt-6 text-sm"><Link href="/auth/login">Back to log in</Link></p>
      </div>
    )
  }

  return (
    <>
      {plan && <p className="mb-4 text-sm text-muted text-center">You&apos;re signing up for the <span className="font-bold capitalize text-ink">{plan}</span> plan. Your 14-day free trial starts after checkout.</p>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormError message={error} />
        <Input label="Full name" type="text" autoComplete="name" required value={name} onChange={e => setName(e.target.value)} />
        <Input label="Email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
        <div>
          <Input label="Password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} />
          <p className="text-xs text-muted mt-1">Minimum 8 characters</p>
        </div>
        <Button type="submit" loading={loading} className="w-full">Create account</Button>
      </form>
      <div className="my-4 flex items-center gap-3 text-xs text-muted" aria-hidden="true">
        <span className="flex-1 border-t border-rule" />or<span className="flex-1 border-t border-rule" />
      </div>
      <Button type="button" variant="secondary" className="w-full" onClick={handleGoogle}>Continue with Google</Button>
      <p className="mt-4 text-xs text-muted text-center">By creating an account you agree to the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.</p>
    </>
  )
}

export default function SignupPage() {
  return (
    <AuthShell title="Create your account" footer={<>Already have an account? <Link href="/auth/login">Log in</Link></>}>
      <Suspense fallback={null}>
        <SignupForm />
      </Suspense>
    </AuthShell>
  )
}
