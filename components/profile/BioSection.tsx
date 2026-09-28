import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface BioSectionProps {
  content: string | null
  emptyMessage?: string
}

export function BioSection({ content, emptyMessage = 'No summary available yet.' }: BioSectionProps) {
  if (!content) return <p className="text-sm text-muted py-4">{emptyMessage}</p>
  return (
    <div className="prose max-w-none text-[17px] leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}
