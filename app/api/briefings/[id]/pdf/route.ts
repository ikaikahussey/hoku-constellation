/** PDF export of a bill briefing or dossier (E4/E7). */
import { NextResponse } from 'next/server'
import { getWorkspace } from '@/lib/workspace'
import { briefingDocModel, getOrBuildBriefing } from '@/lib/briefings'
import { renderPdf } from '@/lib/render/pdf'

export const maxDuration = 120

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const ws = await getWorkspace()
  if (!ws) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const kind = (await ws.db.one<{ kind: string }>(`select kind from entity where id = $1`, [id]))?.kind
  if (!kind || !['bill', 'person', 'org'].includes(kind)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(kind === 'bill' ? ws.features.briefings : ws.features.dossiers)) return NextResponse.json({ error: 'Included in Pro and Organization plans' }, { status: 403 })
  const row = await getOrBuildBriefing(ws.db, id)
  const pdf = await renderPdf(await briefingDocModel(ws.db, row))
  const name = row.content.entity.name.replace(/[^A-Za-z0-9]+/g, '-')
  return new NextResponse(Buffer.from(pdf), { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${kind === 'bill' ? 'briefing' : 'dossier'}-${name}.pdf"`, 'cache-control': 'private, no-store' } })
}
