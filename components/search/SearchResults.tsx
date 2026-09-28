import { EntityCard, type EntityCardProps } from './EntityCard'
import { TrackSearch } from './TrackSearch'

interface SearchResultsProps {
  results: EntityCardProps[]
  query: string
  total: number
  kind?: string
}

export function SearchResults({ results, query, total, kind }: SearchResultsProps) {
  if (results.length === 0) {
    return (
      <div className="py-16 text-center">
        <TrackSearch queryLength={query.length} resultCount={0} kind={kind} />
        <h3 className="text-lg font-bold mb-1">No results found</h3>
        <p className="text-sm text-muted">
          {query ? `No matches for “${query}”. Try a different search term.` : 'Enter a search term to find people, organizations, and bills.'}
        </p>
      </div>
    )
  }

  return (
    <div>
      <TrackSearch queryLength={query.length} resultCount={total} kind={kind} />
      <p className="text-sm text-muted mb-4 tabular">
        {total} result{total !== 1 ? 's' : ''}{query ? ` for “${query}”` : ''}
      </p>
      <div className="space-y-3">
        {results.map(result => (
          <EntityCard key={`${result.kind}-${result.id}`} {...result} />
        ))}
      </div>
    </div>
  )
}
