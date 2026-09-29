import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireWorkspace } from '@/lib/workspace'
import { isoString } from '@/lib/format'
import { getReport, uncitedSentences } from '@/lib/reports'
import { citationNumbers } from '@/lib/render/model'
import { ReportEditor } from '@/components/workspace/ReportEditor'
import { ActionForm } from '@/components/workspace/ActionForm'
import { UpgradeNotice } from '@/components/workspace/Upgrade'
import { Badge } from '@/components/ui/Badge'
import { buttonClass } from '@/components/ui/Button'
import { approveReportAction, deleteReportAction, sendReportAction } from '../../actions'

export const metadata = { title: 'Report' }

interface Props { params: Promise<{ id: string }> }

export default async function ReportPage({ params }: Props) {
  const { id } = await params
  const ws = await requireWorkspace(`/workspace/reports/${id}`)
  if (!ws.features.reports) return <UpgradeNotice feature="Client reports" tier={ws.features.tier} />
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const report = await getReport(ws.db, ws.team.id, id)
  if (!report) notFound()
  const c = report.content
  const sources = report.cited_document_ids.length ? await ws.db.many<{ id: string; title: string | null; source: string; doc_date: string | null }>(
    `select id, title, source, doc_date::text doc_date from document where id = any($1::uuid[])`, [report.cited_document_ids]) : []
  const nums = Object.fromEntries(citationNumbers({ title: '', generatedAt: '', sources: sources.map(s => ({ ...s, url: null })),
    sections: [{ heading: '', blocks: c.narrative.blocks }, ...c.sections.map(s => ({ heading: s.title, blocks: s.items.map(i => ({ type: 'li' as const, runs: [{ text: i.text, cites: i.documentIds }] })) }))] }))
  const ordered = [...sources].sort((a, b) => (nums[a.id] ?? 0) - (nums[b.id] ?? 0))
  const warnings = uncitedSentences(c.narrative.blocks)
  const cite = (ids: string[]) => ids.map(d => <sup key={d}><a href={`/documents/${d}`} className="link-quiet">[{nums[d]}]</a></sup>)
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted"><Link href="/workspace/reports">Reports</Link> · {c.period.start} to {c.period.end}</p>
          <h1 className="text-3xl font-bold">{c.client.name}</h1>
          <p className="mt-1 flex gap-2 items-center"><Badge variant={report.status === 'sent' ? 'solid' : 'outline'}>{report.status}</Badge>
            <span className="text-sm text-muted">{c.narrative.source === 'model' ? 'Summary drafted by AI from cited records' : c.narrative.source === 'edited' ? 'Summary edited by your team' : 'Summary compiled directly from records'}
              {report.approved_at && ` · approved ${isoString(report.approved_at).slice(0, 10)}`}{report.sent_at && ` · sent ${isoString(report.sent_at).slice(0, 10)}`}</span></p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/reports/${report.id}/file?format=pdf`} className={buttonClass('secondary', 'sm')}>Download PDF</a>
          <a href={`/api/reports/${report.id}/file?format=docx`} className={buttonClass('secondary', 'sm')}>Download Word</a>
        </div>
      </header>

      <section aria-labelledby="summary">
        <h2 id="summary" className="text-xl font-bold mb-3">Summary</h2>
        <ReportEditor reportId={report.id} blocks={c.narrative.blocks} recipients={report.recipients} numbers={nums} locked={report.status === 'sent'} />
        {warnings.length > 0 && report.status !== 'sent' && (
          <div role="alert" className="border border-ink p-3 mt-3 text-sm">
            <strong>⚠ {warnings.length} sentence{warnings.length === 1 ? '' : 's'} without a citation:</strong>
            <ul className="list-disc ml-5 mt-1">{warnings.map(w => <li key={w}>{w}</li>)}</ul>
          </div>
        )}
      </section>

      {report.status !== 'sent' && (
        <section aria-labelledby="workflow" className="border border-ink p-5 space-y-4">
          <h2 id="workflow" className="text-lg font-bold">Approve and send</h2>
          {report.status === 'draft' ? (
            <form action={approveReportAction}><input type="hidden" name="report_id" value={report.id} />
              <p className="text-sm mb-2">Approving locks the PDF and Word files. Any later edit returns the report to draft.</p>
              <button type="submit" className={buttonClass('primary', 'sm')}>Approve report</button></form>
          ) : (
            <ActionForm action={sendReportAction} submit={`Send to ${report.recipients.length} recipient${report.recipients.length === 1 ? '' : 's'}`}>
              <input type="hidden" name="report_id" value={report.id} />
              <p className="text-sm">Approved. The email goes from “{ws.team.sender_name ?? ws.team.name}” with the PDF and Word files attached.</p>
            </ActionForm>
          )}
          {report.status === 'draft' && <form action={deleteReportAction}><input type="hidden" name="report_id" value={report.id} /><button type="submit" className="text-sm underline">Delete draft</button></form>}
        </section>
      )}

      {c.sections.filter(s => s.items.length).map(s => (
        <section key={s.key}>
          <h2 className="text-lg font-bold mb-2 pb-1 border-b border-ink">{s.title}</h2>
          <ul className="space-y-1">{s.items.map((i, n) => <li key={n}>{i.date && <span className="tabular text-muted">{i.date} — </span>}{i.text} {cite(i.documentIds)}</li>)}</ul>
        </section>
      ))}

      <section>
        <h2 className="text-lg font-bold mb-2 pb-1 border-b border-ink">Sources</h2>
        <ol className="text-sm space-y-1">{ordered.map(s => <li key={s.id}>[{nums[s.id]}] <a href={`/documents/${s.id}`}>{s.title ?? `${s.source} record`}</a> <span className="text-muted">— {s.source.replace(/_/g, ' ')}{s.doc_date ? `, ${s.doc_date}` : ''}</span></li>)}</ol>
      </section>
    </div>
  )
}
