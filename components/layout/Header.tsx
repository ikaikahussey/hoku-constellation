'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Wordmark } from '@/components/brand/Wordmark'
import { buttonClass } from '@/components/ui/Button'

const navLinks = [
  { href: '/search', label: 'Search' },
  { href: '/explore', label: 'Explore' },
  { href: '/documents', label: 'Documents' },
  { href: '/pricing', label: 'Pricing' },
]

interface HeaderProps {
  /** When true, the right side shows "Account" instead of "Log in". */
  signedIn?: boolean
}

export function Header({ signedIn = false }: HeaderProps) {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-50 bg-paper border-b border-rule">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <Link href="/" aria-label="HOKU Insider home" className="flex items-center text-ink">
            <Wordmark height={20} />
          </Link>

          <nav aria-label="Primary" className="hidden md:flex items-center gap-6">
            {navLinks.map(link => {
              const active = pathname === link.href || pathname.startsWith(`${link.href}/`)
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  className={`text-sm ${active ? 'font-bold' : ''}`}
                >
                  {link.label}
                </Link>
              )
            })}
          </nav>

          <div className="flex items-center gap-4">
            {signedIn ? (
              <>
                <Link href="/workspace" className="text-sm link-quiet">Workspace</Link>
                <Link href="/account" className="text-sm link-quiet">Account</Link>
              </>
            ) : (
              <Link href="/auth/login" className="text-sm link-quiet">Log in</Link>
            )}
            <Link href="/pricing" className={buttonClass('secondary', 'sm')}>Subscribe</Link>
          </div>
        </div>
      </div>
    </header>
  )
}
