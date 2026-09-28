import type { DocumentForEntity } from '@/lib/db/queries'
import { formatDate, humanize } from './format'

/** Documents backing an entity's edges, newest first. */
export function DocumentList({ documents }: { documents: DocumentForEntity[] }) {
  return (
    <section className="card bg-paper border border-rule p-6 mb-6">
      <h2 className="text-lg font-bold mb-4">Documents <span className="text-muted font-normal text-sm">{documents.length.toLocaleString()} shown</span></h2>
      {documents.length === 0 ? (
        <p className="text-sm text-muted">No documents.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular">
            <thead>
              <tr className="border-b border-ink">
                <th scope="col" className="py-2 pr-3 text-left text-xs font-bold uppercase tracking-wide">Date</th>
                <th scope="col" className="py-2 pr-3 text-left text-xs font-bold uppercase tracking-wide">Title</th>
                <th scope="col" className="py-2 pr-3 text-left text-xs font-bold uppercase tracking-wide">Type</th>
                <th scope="col" className="py-2 pr-3 text-left text-xs font-bold uppercase tracking-wide">Via</th>
                <th scope="col" className="py-2 text-left text-xs font-bold uppercase tracking-wide">Source</th>
              </tr>
            </thead>
            <tbody>
              {documents.map(d => (
                <tr key={d.id} className="border-b border-rule">
                  <td className="py-2 pr-3 whitespace-nowrap text-xs">{formatDate(d.doc_date)}</td>
                  <td className="py-2 pr-3">
                    {d.url ? <a href={d.url} target="_blank" rel="noopener noreferrer">{d.title || d.url}</a> : (d.title || <span className="text-gray-400">untitled</span>)}
                  </td>
                  <td className="py-2 pr-3 text-xs text-muted">{humanize(d.doc_type)}</td>
                  <td className="py-2 pr-3 text-xs text-muted">{humanize(d.edge_type)}{d.role ? ` · ${d.role}` : ''}</td>
                  <td className="py-2 text-xs text-muted font-mono">{d.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
