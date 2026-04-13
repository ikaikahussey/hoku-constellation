import { EntityCard } from './EntityCard'

interface SearchResult {
  id: string
  type: 'person' | 'organization'
  name: string
  slug: string | null
  subtitle: string | null
  badges: string[]
  island: string | null
  status: string
}

interface SearchResultsProps {
  results: SearchResult[]
  query: string
  total: number
}

export function SearchResults({ results, query, total }: SearchResultsProps) {
  if (results.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-white/60 mb-1">No results found</h3>
        <p className="text-sm text-white/30">
          {query ? `No matches for "${query}". Try a different search term.` : 'Enter a search term to find people and organizations.'}
        </p>
      </div>
    )
  }

  return (
    <div>
      <p className="text-sm text-white/40 mb-4">
        {total} result{total !== 1 ? 's' : ''}{query ? ` for "${query}"` : ''}
      </p>
      <div className="space-y-3">
        {results.map((result) => (
          <EntityCard key={`${result.type}-${result.id}`} {...result} />
        ))}
      </div>
    </div>
  )
}
