'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Wordmark } from '@/components/brand/Wordmark'

const navItems = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/person', label: 'People' },
  { href: '/admin/org', label: 'Organizations' },
  { href: '/admin/articles', label: 'Articles' },
  { href: '/admin/import', label: 'Data Import' },
  { href: '/admin/match-review', label: 'Match Review' },
  { href: '/admin/workers', label: 'Pipeline Status' },
  { href: '/admin/analytics', label: 'Analytics' },
  { href: '/admin/alerts', label: 'Alerts' },
  { href: '/admin/corrections', label: 'Corrections' },
  { href: '/admin/partners', label: 'Design partners' },
  { href: '/admin/bulk-create', label: 'Bulk Create' },
]

export function AdminNav() {
  const pathname = usePathname()

  return (
    <aside className="w-full md:w-56 md:min-h-screen border-b md:border-b-0 md:border-r border-rule bg-paper flex-shrink-0 flex flex-col">
      <div className="p-4 border-b border-rule">
        <Link href="/" className="link-quiet inline-flex items-center gap-2 text-ink" aria-label="HOKU Insider home">
          <Wordmark height={16} />
          <span className="text-xs font-bold uppercase tracking-wide border-l border-ink pl-2">Admin</span>
        </Link>
      </div>
      <nav className="p-2 flex md:flex-col flex-wrap gap-0.5" aria-label="Admin">
        {navItems.map(item => {
          const isActive = pathname === item.href || (item.href !== '/admin' && pathname.startsWith(item.href))
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={`block px-3 py-2 text-sm text-ink border-l-2 ${isActive ? 'border-ink font-bold' : 'border-transparent hover:border-rule'}`}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div className="mt-auto p-4 border-t border-rule">
        <Link href="/" className="text-xs text-ink">← Back to site</Link>
      </div>
    </aside>
  )
}
