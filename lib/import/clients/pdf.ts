/**
 * PDF text extraction (unpdf — serverless-friendly pdf.js build). Used for testimony packets, ethics
 * disclosures, procurement notices, Environmental Notice issues.
 */
import { fetchBuffer } from '../http'

export interface PdfText { text: string; pages: string[]; numPages: number }

export async function extractPdfText(buffer: Buffer | Uint8Array): Promise<PdfText> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const pdf = await getDocumentProxy(data)
  const { text, totalPages } = await extractText(pdf, { mergePages: false })
  const pages = Array.isArray(text) ? text : [String(text)]
  return { text: pages.join('\n\f\n'), pages, numPages: totalPages }
}

export async function fetchPdfText(url: string): Promise<PdfText> {
  const buf = await fetchBuffer(url)
  return extractPdfText(buf)
}

/** Collapse whitespace and drop form feeds for matching. */
export function normalizePdfText(text: string): string {
  return text.replace(/\f/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}
