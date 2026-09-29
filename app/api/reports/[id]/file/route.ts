/** Download a client report as PDF or DOCX (team members on a plan with reports). Drafts render as previews. */
import { NextResponse, type NextRequest } from 'next/server'
import { getWorkspace } from '@/lib/workspace'
import { getReportFile } from '@/lib/reports'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ws = await getWorkspace()
  if (!ws) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (!ws.features.reports) return NextResponse.json({ error: 'Reports are not included in this plan' }, { status: 403 })
  const format = request.nextUrl.searchParams.get('format') === 'docx' ? 'docx' : 'pdf'
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const f = await getReportFile(ws.db, ws.team.id, id, format)
  if (!f) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return new NextResponse(Buffer.from(f.bytes), { headers: { 'content-type': f.contentType, 'content-disposition': `attachment; filename="${f.filename}"`, 'cache-control': 'private, no-store' } })
}
