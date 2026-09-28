import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/pglite'
import * as comp from '@/lib/import/sources/employee-compensation'
import { runImporter } from '@/lib/import/run'
import { edgesFor } from './_harness'

const CSV = `Employee Name,Department,Position Title,Annual Salary,Fiscal Year
"Kealoha, Mary",Department of Education,Teacher,"$78,500",FY2025
"Nakamura, Ken",Department of Transportation,Engineer V,112000,2025
,Department of Health,Nurse,90000,2025
`
let db: TestDb
beforeAll(async () => { db = await createTestDb() })
afterAll(async () => { await db.end() })

describe('employee_compensation (manual CSV)', () => {
  it('parses rows and skips rows without a name', () => {
    const rows = comp.parseCompCsv(CSV)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ name: 'Kealoha, Mary', employer: 'Department of Education', title: 'Teacher', amount: 78500, year: 2025 })
  })
  it('imports from params.csv: employers created, employees resolve-only; idempotent', async () => {
    const opts = { params: { csv: CSV, filename: 'comp.csv' }, resume: false, log: () => {} }
    const first = await runImporter(db, comp.SOURCE_KEY, comp.importBatch, opts)
    expect(first).toMatchObject({ documents: 2, edges: 2, entitiesCreated: 2, errors: 0, done: true })
    const second = await runImporter(db, comp.SOURCE_KEY, comp.importBatch, opts)
    expect(second).toMatchObject({ documents: 0, edges: 0, entitiesCreated: 0 })
    const edges = await edgesFor(db, 'employee_compensation')
    expect(edges[0]).toMatchObject({ type: 'employed_by', match_status: 'review', amount: '78500.00', start_date: '2025-07-01' })
  })
  it('refuses to run without a CSV', async () => {
    await expect(comp.importBatch(db, 0, 10, {})).rejects.toThrow(/--file/)
  })
})
