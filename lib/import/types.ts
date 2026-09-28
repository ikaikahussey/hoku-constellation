import type { Db } from '@/lib/db/types'
import type { BatchResult } from './pipeline'

/** A page of raw source records. `total` is optional (some APIs do not report it). */
export interface SourcePage<T = Record<string, unknown>> {
  records: T[]
  total?: number
  /** Opaque continuation (e.g. FEC last_index) persisted in import_cursor.metadata by the importer. */
  next?: Record<string, unknown> | null
  done?: boolean
}

export type PageFetcher<T = Record<string, unknown>> = (offset: number, limit: number, params: Record<string, string>) => Promise<SourcePage<T>>

export interface ImportOptions {
  /** Do everything except write; counts what would be written. */
  dry?: boolean
  /** Stop after this many source records. */
  limit?: number
  /** Source-specific options (session year, county, resource id, …). */
  params?: Record<string, string>
  log?: (msg: string) => void
  /**
   * Test hook: replaces the network page fetcher with fixture data so parsing, validation,
   * normalization, dedup, cursor advancement and entity routing can be tested offline.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pageSource?: PageFetcher<any>
}

/** Every lib/import/sources/<source>.ts exports one of these as `importBatch` plus `SOURCE_KEY`. */
export type BatchImporter = (db: Db, offset: number, batchSize: number, opts?: ImportOptions) => Promise<BatchResult>

export interface SourceModule {
  SOURCE_KEY: string
  importBatch: BatchImporter
}

export type { BatchResult }
