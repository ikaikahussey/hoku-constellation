import Link from 'next/link'

interface EntityCardProps {
  id: string
  type: 'person' | 'organization'
  name: string
  slug: string | null
  subtitle: string | null
  badges: string[]
  island: string | null
  status: string
}

export function EntityCard({ type, name, slug, subtitle, badges, island, status }: EntityCardProps) {
  const href = type === 'person' ? `/person/${slug}` : `/org/${slug}`

  return (
    <Link href={href} className="block">
      <div className="bg-navy-light rounded-lg border border-white/10 p-4 hover:border-gold/30 transition-colors">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${type === 'person' ? 'bg-gold' : 'bg-ocean'}`} />
              <h3 className="text-white font-medium truncate">{name}</h3>
            </div>
            {subtitle && (
              <p className="text-sm text-white/50 ml-4">{subtitle}</p>
            )}
            <div className="flex flex-wrap gap-1.5 mt-2 ml-4">
              {badges.map((badge) => (
                <span
                  key={badge}
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                    type === 'person'
                      ? 'bg-gold/10 text-gold/80'
                      : 'bg-ocean/20 text-white/70'
                  }`}
                >
                  {badge.replace(/_/g, ' ')}
                </span>
              ))}
              {island && (
                <span className="inline-flex items-center rounded-full bg-white/5 px-2 py-0.5 text-xs text-white/40">
                  {island}
                </span>
              )}
            </div>
          </div>
          <span className={`text-xs flex-shrink-0 ${status === 'active' ? 'text-green-400/70' : 'text-white/30'}`}>
            {status}
          </span>
        </div>
      </div>
    </Link>
  )
}
