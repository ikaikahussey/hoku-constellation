import Link from 'next/link'
import type { DocumentSummary } from '@/lib/db/queries/documents'
import { Badge } from '@/components/ui/Badge'
import { formatShortDate } from '@/lib/format'
import { docTypeLabel, sourceLabel, sourceTitle } from './labels'

export function documentTitle(d: Pick<DocumentSummary, 'title' | 'source_record_id' | 'doc_type'>): string {
  return d.title?.trim() || (d.source_record_id ? `${docTypeLabel(d.doc_type)} ${d.source_record_id}` : docTypeLabel(d.doc_type))
}

export function DocumentTable({ rows }: { rows: DocumentSummary[] }) {
  if (rows.length === 0) return <p className="py-16 text-center text-muted">No documents match these filters.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Documents</caption>
        <thead>
          <tr className="border-b border-ink text-xs font-bold uppercase tracking-wide">
            <th scope="col" className="py-2 pr-3 text-left w-28">Date</th>
            <th scope="col" className="py-2 pr-3 text-left">Document</th>
            <th scope="col" className="py-2 pr-3 text-left">Type</th>
            <th scope="col" className="py-2 pr-3 text-left">Source</th>
            <th scope="col" className="py-2 text-right w-20">Facts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(d => (
            <tr key={d.id} className="border-b border-rule align-top">
              <td className="py-2.5 pr-3 tabular text-muted whitespace-nowrap">{d.doc_date ? formatShortDate(d.doc_date) : '—'}</td>
              <td className="py-2.5 pr-3">
                <Link href={`/documents/${d.id}`} className="font-bold">{documentTitle(d)}</Link>
                {d.excerpt && <p className="text-muted text-xs mt-0.5 line-clamp-2">{d.excerpt}</p>}
              </td>
              <td className="py-2.5 pr-3 whitespace-nowrap"><Badge variant="outline">{docTypeLabel(d.doc_type)}</Badge></td>
              <td className="py-2.5 pr-3 whitespace-nowrap" title={sourceTitle(d.source)}>{sourceLabel(d.source)}</td>
              <td className="py-2.5 text-right tabular">{d.edge_count.toLocaleString('en-US')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
