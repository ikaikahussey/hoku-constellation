'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { getAuthClient } from '@/lib/db/browser'
import { AuthShell, FormError } from '@/components/auth/AuthShell'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/search'
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = safeNext(searchParams.get('next'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(searchParams.get('error') ? 'Sign-in failed. Please try again.' : '')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await getAuthClient().signIn.email({ email, password })
    if (error) {
      setError(error.message ?? 'Sign-in failed.')
      setLoading(false)
      return
    }
    router.push(next)
    router.refresh()
  }

  async function handleGoogle() {
    setError('')
    const callbackURL = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
    const { error } = await getAuthClient().signIn.social({ provider: 'google', callbackURL })
    if (error) setError(error.message ?? 'Google sign-in failed.')
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormError message={error} />
        <Input label="Email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
        <Input label="Password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
        <Button type="submit" loading={loading} className="w-full">Log in</Button>
      </form>
      <div className="my-4 flex items-center gap-3 text-xs text-muted" aria-hidden="true">
        <span className="flex-1 border-t border-rule" />or<span className="flex-1 border-t border-rule" />
      </div>
      <Button type="button" variant="secondary" className="w-full" onClick={handleGoogle}>Continue with Google</Button>
      <p className="mt-4 text-center text-sm"><Link href="/auth/reset-password">Forgot your password?</Link></p>
    </>
  )
}

export default function LoginPage() {
  return (
    <AuthShell title="Log in" footer={<>Don&apos;t have an account? <Link href="/auth/signup">Sign up</Link></>}>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  )
}
