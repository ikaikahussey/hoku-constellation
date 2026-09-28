'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { getAuthClient } from '@/lib/db/browser'
import { AuthShell, FormError } from '@/components/auth/AuthShell'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

/** Step 1: ask for the email and send a reset link that returns here with ?token=. */
function RequestForm() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const redirectTo = `${window.location.origin}/auth/reset-password`
    const { error } = await safe(() => getAuthClient().requestPasswordReset({ email, redirectTo }))
    if (error) {
      setError(error.message ?? 'Could not send a reset link.')
      setLoading(false)
      return
    }
    setSent(true)
    setLoading(false)
  }

  if (sent) {
    return (
      <p className="text-center text-muted">
        If an account exists for <strong className="text-ink" data-ph-mask>{email}</strong>, a password reset link is on its way. Check your inbox.
      </p>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-muted">Enter the email on your account and we&apos;ll send you a link to choose a new password.</p>
      <FormError message={error} />
      <Input label="Email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
      <Button type="submit" loading={loading} className="w-full">Send reset link</Button>
    </form>
  )
}

/** Step 2: the link from the email carries ?token=; set the new password. */
function ResetForm({ token }: { token: string }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    setError('')
    const { error } = await safe(() => getAuthClient().resetPassword({ newPassword: password, token }))
    if (error) {
      setError(error.message ?? 'Could not reset your password. The link may have expired.')
      setLoading(false)
      return
    }
    router.push('/auth/login')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormError message={error} />
      <Input label="New password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} />
      <Input label="Confirm new password" type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={e => setConfirm(e.target.value)} />
      <Button type="submit" loading={loading} className="w-full">Set new password</Button>
    </form>
  )
}

function ResetPasswordInner() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const invalid = searchParams.get('error') === 'INVALID_TOKEN'
  return (
    <>
      {invalid && <div className="mb-4"><FormError message="That reset link is invalid or has expired. Request a new one below." /></div>}
      {token && !invalid ? <ResetForm token={token} /> : <RequestForm />}
    </>
  )
}

/** Client calls throw when NEXT_PUBLIC_NEON_AUTH_URL is missing or the network is down; surface that as a form error. */
async function safe<T extends { data?: unknown; error?: { message?: string } | null }>(fn: () => Promise<T>): Promise<{ error: { message?: string } | null; data: T['data'] | null }> {
  try { const r = await fn(); return { error: r.error ?? null, data: r.data ?? null } } catch (e) { return { error: { message: (e as Error).message || 'Something went wrong. Please try again.' }, data: null } }
}

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Reset password" footer={<><Link href="/auth/login">Back to log in</Link></>}>
      <Suspense fallback={null}>
        <ResetPasswordInner />
      </Suspense>
    </AuthShell>
  )
}
