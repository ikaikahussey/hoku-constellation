import Link from 'next/link'
import { Wordmark } from '@/components/brand/Wordmark'

/** Centered card used by the login, signup, and password-reset pages. */
export function AuthShell({ title, children, footer }: { title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-paper">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" aria-label="HOKU Insider home" className="inline-flex text-ink mb-6">
            <Wordmark height={22} />
          </Link>
          <h1 className="text-3xl font-bold">{title}</h1>
        </div>
        {children}
        {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
      </div>
    </div>
  )
}

export function FormError({ message }: { message: string }) {
  if (!message) return null
  return <p role="alert" className="text-sm border border-ink p-3">⚠ {message}</p>
}
