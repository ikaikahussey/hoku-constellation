'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navLinks = [
  { href: '/search', label: 'Search' },
  { href: '/explore', label: 'Explore' },
  { href: '/pricing', label: 'Pricing' },
]

export function Header() {
  const pathname = usePathname()

  return (
    <header className="border-b border-white/10 bg-navy/95 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-lg font-bold text-white tracking-tight">HOKU</span>
            <span className="text-lg font-light text-white/80 tracking-wider">CONSTELLATION</span>
          </Link>

          <nav className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`text-sm transition-colors ${
                  pathname === link.href
                    ? 'text-gold font-medium'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href="/auth/login"
              className="text-sm text-white/60 hover:text-white transition-colors"
            >
              Log in
            </Link>
            <Link
              href="/auth/signup"
              className="text-sm bg-gold text-navy px-4 py-2 rounded-md font-semibold hover:bg-gold-light transition-colors"
            >
              Subscribe
            </Link>
          </div>
        </div>
      </div>
    </header>
  )
}
