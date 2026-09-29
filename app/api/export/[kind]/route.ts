/** GET /api/export/<kind>.csv — CSV of any list view (E7). Requires the exports entitlement. */
import { NextResponse, type NextRequest } from 'next/server'
import { getWorkspace } from '@/lib/workspace'
import { exportRows, EXPORT_KINDS, type ExportKind } from '@/lib/export/lists'
import { toCsv, csvFilename } from '@/lib/export/csv'
import { EVENTS } from '@/lib/analytics-events'
import { captureServerEvent } from '@/lib/analytics-server'

export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const kind = (await params).kind.replace(/\.csv$/, '') as ExportKind
  if (!EXPORT_KINDS.includes(kind)) return NextResponse.json({ error: 'Unknown export' }, { status: 404 })
  const ws = await getWorkspace()
  if (!ws) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (!ws.features.exports && !ws.user.isStaff) return NextResponse.json({ error: 'CSV export is included in Pro and Organization plans' }, { status: 403 })
  try {
    const { rows, columns, label } = await exportRows(ws.db, kind, request.nextUrl.searchParams, ws.user.id)
    await captureServerEvent(ws.user.id, EVENTS.EXPORT_CLICKED, { format: 'csv', location: kind })
    return new NextResponse(toCsv(rows, columns), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${csvFilename(label)}"`, 'cache-control': 'private, no-store' } })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
