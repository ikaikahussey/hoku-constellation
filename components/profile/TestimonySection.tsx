import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'

interface TestimonySectionProps {
  testimony: Record<string, unknown>[]
}

const positionVariant: Record<string, 'success' | 'error' | 'default'> = {
  support: 'success',
  oppose: 'error',
  comment: 'default',
}

export function TestimonySection({ testimony }: TestimonySectionProps) {
  if (testimony.length === 0) {
    return <p className="text-white/30 text-sm py-4">No legislative testimony records linked yet.</p>
  }

  const supportCount = testimony.filter((t) => t.position === 'support').length
  const opposeCount = testimony.filter((t) => t.position === 'oppose').length
  const commentCount = testimony.filter((t) => t.position === 'comment').length

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-navy-light rounded-lg border border-white/10 p-4 text-center">
          <p className="text-sm text-white/50">Support</p>
          <p className="text-2xl font-bold text-green-300">{supportCount}</p>
        </div>
        <div className="bg-navy-light rounded-lg border border-white/10 p-4 text-center">
          <p className="text-sm text-white/50">Oppose</p>
          <p className="text-2xl font-bold text-red-300">{opposeCount}</p>
        </div>
        <div className="bg-navy-light rounded-lg border border-white/10 p-4 text-center">
          <p className="text-sm text-white/50">Comment</p>
          <p className="text-2xl font-bold text-white/70">{commentCount}</p>
        </div>
      </div>

      <div className="space-y-2">
        {testimony.map((t) => {
          const person = t.person as Record<string, unknown> | null
          return (
            <div key={t.id as string} className="bg-navy-light rounded-md border border-white/10 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-mono text-gold">{String(t.bill_number)}</span>
                    <Badge variant={positionVariant[t.position as string] || 'default'}>
                      {String(t.position)}
                    </Badge>
                    <span className="text-xs text-white/30">{String(t.session)}</span>
                  </div>
                  {t.committee ? (
                    <p className="text-xs text-white/40 mt-1">{String(t.committee)}</p>
                  ) : null}
                  {person ? (
                    <p className="text-xs text-white/50 mt-1">
                      Testified by{' '}
                      <Link
                        href={`/person/${person.slug as string}`}
                        className="text-white/60 hover:text-gold transition-colors"
                      >
                        {person.full_name as string}
                      </Link>
                    </p>
                  ) : null}
                </div>
                <div className="text-right flex-shrink-0">
                  {t.hearing_date ? (
                    <span className="text-xs text-white/30">
                      {new Date(t.hearing_date as string).toLocaleDateString()}
                    </span>
                  ) : null}
                  {t.testimony_url ? (
                    <a
                      href={String(t.testimony_url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-xs text-gold/50 hover:text-gold mt-0.5"
                    >
                      View
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-white/20">
        Source: Hawai&#699;i State Legislature testimony submissions.
      </p>
    </div>
  )
}
