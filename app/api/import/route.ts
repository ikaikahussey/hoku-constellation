/**
 * POST /api/import  (multipart: file, source)
 * Staff CSV upload for manual sources: `employee_compensation` (UIPA data) and `dcca_breg` (DCCA Entity
 * List Builder export or UIPA extract). Every fetchable source runs through /api/admin/import-source so
 * provenance stays with the live fetcher.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateStaff } from '@/app/api/analytics/_lib/auth'
import { runImporter } from '@/lib/import/run'
import { getCursor, setCursor } from '@/lib/import/pipeline'
import * as employeeCompensation from '@/lib/import/sources/employee-compensation'
import * as dccaBreg from '@/lib/import/sources/dcca-breg'
import type { SourceModule } from '@/lib/import/types'

const MANUAL_SOURCES: Record<string, SourceModule> = {
  [employeeCompensation.SOURCE_KEY]: employeeCompensation,
  [dccaBreg.SOURCE_KEY]: dccaBreg,
}

export const maxDuration = 300
const BUDGET_MS = 280_000
export const dynamic = 'force-dynamic'
const MAX_BYTES = 20 * 1024 * 1024

export async function POST(request: NextRequest) {
  const { error, db } = await authenticateStaff()
  if (error) return error
  const formData = await request.formData()
  const file = formData.get('file')
  const source = formData.get('source')
  const dry = formData.get('dry') === '1'
  if (!(file instanceof File) || typeof source !== 'string') return NextResponse.json({ error: 'file and source are required' }, { status: 400 })
  const mod = MANUAL_SOURCES[source]
  if (!mod) return NextResponse.json({ error: `CSV upload is only accepted for ${Object.keys(MANUAL_SOURCES).join(', ')}; run "${source}" from the importer list instead` }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'file exceeds 20 MB' }, { status: 413 })
  const csv = await file.text()
  const logs: string[] = []
  try {
    // Large registry exports can outrun one request. The summary then reports done:false, and uploading the
    // same file again resumes at the saved offset instead of starting over.
    const uploadKey = `${file.name}:${file.size}`
    const cursor = await getCursor(db, mod.SOURCE_KEY)
    const offset = !dry && cursor.status !== 'complete' && cursor.metadata.upload_file === uploadKey ? cursor.cursor_offset : 0
    if (!dry) await setCursor(db, mod.SOURCE_KEY, offset, 'running', { upload_file: uploadKey })
    const summary = await runImporter(db, mod.SOURCE_KEY, mod.importBatch, { dry, offset, batchSize: 500, deadlineMs: Date.now() + BUDGET_MS, params: { csv, filename: file.name }, log: (m) => { if (logs.length < 50) logs.push(m) } })
    return NextResponse.json({ ...summary, resumedFrom: offset, filename: file.name, logs })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, logs }, { status: 500 })
  }
}
