interface ArticleListProps {
  mentions: Record<string, unknown>[]
}

export function ArticleList({ mentions }: ArticleListProps) {
  if (mentions.length === 0) {
    return <p className="text-white/30 text-sm py-4">No linked articles yet.</p>
  }

  return (
    <div className="space-y-3">
      {mentions.map((mention, i) => {
        const article = mention.article as Record<string, unknown> | null
        if (!article) return null
        return (
          <a
            key={i}
            href={article.url as string}
            target="_blank"
            rel="noopener noreferrer"
            className="block bg-navy-light rounded-lg border border-white/10 p-4 hover:border-gold/30 transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium text-white hover:text-gold transition-colors">
                  {article.title as string}
                </h3>
                {article.summary ? (
                  <p className="text-xs text-white/40 mt-1 line-clamp-2">{String(article.summary)}</p>
                ) : null}
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-white/30">{String(article.source || '').replace(/_/g, ' ')}</span>
                  {article.published_at ? (
                    <span className="text-xs text-white/20">
                      {new Date(article.published_at as string).toLocaleDateString()}
                    </span>
                  ) : null}
                </div>
              </div>
              <span className="text-xs rounded-full bg-white/5 px-2 py-0.5 text-white/30 flex-shrink-0">
                {(mention.mention_type as string || '').replace(/_/g, ' ')}
              </span>
            </div>
          </a>
        )
      })}
    </div>
  )
}
