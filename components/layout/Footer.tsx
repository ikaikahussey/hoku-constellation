import Link from 'next/link'
import { Wordmark } from '@/components/brand/Wordmark'

export function Footer() {
  return (
    <footer className="border-t border-rule mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <Link href="/" aria-label="HOKU Insider home" className="inline-flex text-ink mb-3">
              <Wordmark height={18} />
            </Link>
            <p className="text-sm text-muted">Mapping Hawaiʻi&apos;s power structure.</p>
            <p className="text-sm text-muted mt-1">
              by <a href="https://hoku.fm" target="_blank" rel="noopener noreferrer">Hoku.fm</a>
            </p>
          </div>

          <nav aria-label="Product">
            <h3 className="text-xs font-bold uppercase tracking-wide mb-3">Product</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/search">Search</Link></li>
              <li><Link href="/explore">Explore</Link></li>
              <li><Link href="/documents">Documents</Link></li>
              <li><Link href="/pricing">Pricing</Link></li>
            </ul>
          </nav>

          <nav aria-label="Browse">
            <h3 className="text-xs font-bold uppercase tracking-wide mb-3">Browse</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/search?type=person&entityType=elected_official">Elected Officials</Link></li>
              <li><Link href="/search?type=person&entityType=lobbyist">Lobbyists</Link></li>
              <li><Link href="/search?type=person&entityType=donor">Campaign Donors</Link></li>
              <li><Link href="/search?type=organization&sector=energy">Energy Sector</Link></li>
            </ul>
          </nav>

          <nav aria-label="About">
            <h3 className="text-xs font-bold uppercase tracking-wide mb-3">About</h3>
            <ul className="space-y-2 text-sm">
              <li><a href="https://hoku.fm" target="_blank" rel="noopener noreferrer">Hoku.fm</a></li>
              <li><Link href="/pricing">Subscribe</Link></li>
              <li><Link href="/coverage">Coverage</Link></li>
              <li><Link href="/methodology">Methodology</Link></li>
              <li><Link href="/accuracy">Accuracy</Link></li>
              <li><Link href="/privacy">Privacy</Link></li>
              <li><Link href="/terms">Terms</Link></li>
              <li><a href="mailto:constellation@hoku.fm">Contact</a></li>
            </ul>
          </nav>
        </div>

        <div className="border-t border-rule mt-8 pt-8">
          <p className="text-xs text-muted">
            &copy; {new Date().getFullYear()} Hoku.fm. All rights reserved. Public records data sourced from state, county, and federal government agencies.
          </p>
        </div>
      </div>
    </footer>
  )
}
