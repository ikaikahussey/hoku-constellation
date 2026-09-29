'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const ITEMS = [
  { href: '/workspace', label: 'Overview' },
  { href: '/workspace/watchlists', label: 'Watchlists & alerts' },
  { href: '/workspace/clients', label: 'Clients' },
  { href: '/workspace/reports', label: 'Reports' },
  { href: '/workspace/ask', label: 'Ask HOKU Insider' },
  { href: '/workspace/team', label: 'Team' },
  { href: '/workspace/billing', label: 'Billing' },
  { href: '/workspace/settings', label: 'Calendar & settings' },
]

export function WorkspaceNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Workspace" className="flex md:flex-col flex-wrap gap-0.5">
      {ITEMS.map(i => {
        const active = i.href === '/workspace' ? pathname === i.href : pathname.startsWith(i.href)
        return (
          <Link key={i.href} href={i.href} aria-current={active ? 'page' : undefined}
            className={`block px-3 py-2 text-sm text-ink border-l-2 ${active ? 'border-ink font-bold' : 'border-transparent hover:border-rule'}`}>
            {i.label}
          </Link>
        )
      })}
    </nav>
  )
}
