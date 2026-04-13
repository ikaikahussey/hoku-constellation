import { parse } from 'csv-parse/sync'
import { readFileSync } from 'fs'

export function parseCSV(filePath: string): Record<string, string>[] {
  const content = readFileSync(filePath, 'utf-8')
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  })
}
