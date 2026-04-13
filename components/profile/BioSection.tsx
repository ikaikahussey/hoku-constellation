import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface BioSectionProps {
  content: string | null
}

export function BioSection({ content }: BioSectionProps) {
  if (!content) {
    return (
      <div className="text-white/30 text-sm py-4">
        No biographical summary available yet.
      </div>
    )
  }

  return (
    <div className="prose prose-invert prose-sm max-w-none prose-headings:text-white prose-p:text-white/70 prose-a:text-gold prose-strong:text-white">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}
