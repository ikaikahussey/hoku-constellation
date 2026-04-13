'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

export default function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Check your email</h1>
          <p className="text-white/50">We sent a confirmation link to <strong className="text-white">{email}</strong>.</p>
          <Link href="/auth/login" className="inline-block mt-6 text-gold hover:text-gold-light text-sm">
            Back to login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6">
            <span className="text-lg font-bold text-white">HOKU</span>
            <span className="text-lg font-light text-white/80 tracking-wider">CONSTELLATION</span>
          </Link>
          <h1 className="text-2xl font-bold text-white">Create your account</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-error/10 border border-error/30 rounded-md p-3 text-sm text-red-300">{error}</div>
          )}
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Full Name</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="block w-full rounded-md border border-white/20 bg-navy-light px-3 py-2 text-white focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="block w-full rounded-md border border-white/20 bg-navy-light px-3 py-2 text-white focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="block w-full rounded-md border border-white/20 bg-navy-light px-3 py-2 text-white focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
            />
            <p className="text-xs text-white/30 mt-1">Minimum 8 characters</p>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gold text-navy py-2.5 rounded-md font-semibold hover:bg-gold-light transition-colors disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-white/40">
          Already have an account?{' '}
          <Link href="/auth/login" className="text-gold hover:text-gold-light">Log in</Link>
        </p>
      </div>
    </div>
  )
}
