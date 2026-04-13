import Link from 'next/link'

export function Footer() {
  return (
    <footer className="border-t border-white/10 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="font-bold text-white">HOKU</span>
              <span className="font-light text-white/80 tracking-wider">CONSTELLATION</span>
            </div>
            <p className="text-sm text-white/40">
              Mapping Hawaiʻi&apos;s power structure.
            </p>
            <p className="text-sm text-white/40 mt-2">
              by{' '}
              <a href="https://hoku.fm" className="text-gold/70 hover:text-gold" target="_blank" rel="noopener noreferrer">
                Hoku.fm
              </a>
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">Product</h3>
            <ul className="space-y-2">
              <li><Link href="/search" className="text-sm text-white/40 hover:text-white/70">Search</Link></li>
              <li><Link href="/explore" className="text-sm text-white/40 hover:text-white/70">Explore</Link></li>
              <li><Link href="/pricing" className="text-sm text-white/40 hover:text-white/70">Pricing</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">Browse</h3>
            <ul className="space-y-2">
              <li><Link href="/explore?filter=elected_official" className="text-sm text-white/40 hover:text-white/70">Elected Officials</Link></li>
              <li><Link href="/explore?filter=lobbyist" className="text-sm text-white/40 hover:text-white/70">Lobbyists</Link></li>
              <li><Link href="/explore?filter=donor" className="text-sm text-white/40 hover:text-white/70">Campaign Donors</Link></li>
              <li><Link href="/explore?sector=energy" className="text-sm text-white/40 hover:text-white/70">Energy Sector</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">About</h3>
            <ul className="space-y-2">
              <li><a href="https://hoku.fm" className="text-sm text-white/40 hover:text-white/70" target="_blank" rel="noopener noreferrer">Hoku.fm</a></li>
              <li><Link href="/pricing" className="text-sm text-white/40 hover:text-white/70">Subscribe</Link></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-white/5 mt-8 pt-8 text-center">
          <p className="text-xs text-white/30">
            &copy; {new Date().getFullYear()} Hoku.fm. All rights reserved. Public records data sourced from state and county government agencies.
          </p>
        </div>
      </div>
    </footer>
  )
}
