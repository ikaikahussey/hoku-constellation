/**
 * POST /api/import  (multipart: file, source)
 * Staff CSV upload for manual sources. Only `employee_compensation` (UIPA data) is accepted; every
 * fetchable source runs through /api/admin/import-source so provenance stays with the live fetcher.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateStaff } from '@/app/api/analytics/_lib/auth'
import { runImporter } from '@/lib/import/run'
import { importBatch, SOURCE_KEY } from '@/lib/import/sources/employee-compensation'

export const maxDuration = 55
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
  if (source !== SOURCE_KEY) return NextResponse.json({ error: `CSV upload is only accepted for ${SOURCE_KEY}; run "${source}" from the importer list instead` }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'file exceeds 20 MB' }, { status: 413 })
  const csv = await file.text()
  const logs: string[] = []
  try {
    const summary = await runImporter(db, SOURCE_KEY, importBatch, { dry, resume: false, batchSize: 500, params: { csv, filename: file.name }, log: (m) => { if (logs.length < 50) logs.push(m) } })
    return NextResponse.json({ ...summary, filename: file.name, logs })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, logs }, { status: 500 })
  }
}
