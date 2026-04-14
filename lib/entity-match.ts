import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Normalize a name for matching.
 *
 * Handles Hawaiian diacritics so that "Kauaʻi" matches "Kauai":
 * - ʻOkina variants (U+02BB, U+2018, U+2019, ASCII `'`, backtick) are stripped.
 * - Kahakō (macrons via combining diacritics) are stripped via NFD normalization.
 */
function normalize(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining marks (kahakō)
    .replace(/[\u02BB\u2018\u2019`']/g, '') // strip ʻokina variants
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshtein(a: string, b: string): number {
  const matrix: number[][] = []
  for (let i = 0; i <= b.length; i++) matrix[i] = [i]
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }
  return matrix[b.length][a.length]
}

export interface MatchCandidate {
  id: string
  name: string
  confidence: number
}

export function matchEntity(
  rawName: string,
  candidates: { id: string; full_name?: string; name?: string; aliases?: string[] }[]
): MatchCandidate[] {
  const normalizedRaw = normalize(rawName)
  const results: MatchCandidate[] = []

  for (const candidate of candidates) {
    const candidateName = candidate.full_name || candidate.name || ''
    const names = [candidateName, ...(candidate.aliases || [])]
    let bestConfidence = 0

    for (const name of names) {
      const normalizedCandidate = normalize(name)

      // Exact match
      if (normalizedRaw === normalizedCandidate) {
        bestConfidence = 1.0
        break
      }

      // Levenshtein-based similarity
      const maxLen = Math.max(normalizedRaw.length, normalizedCandidate.length)
      if (maxLen === 0) continue
      const distance = levenshtein(normalizedRaw, normalizedCandidate)
      const similarity = 1 - distance / maxLen
      bestConfidence = Math.max(bestConfidence, similarity)
    }

    if (bestConfidence >= 0.7) {
      results.push({
        id: candidate.id,
        name: candidateName,
        confidence: Math.round(bestConfidence * 100) / 100,
      })
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence)
}

export function autoMatchThreshold(confidence: number): 'auto_matched' | 'review' | 'unmatched' {
  if (confidence >= 0.95) return 'auto_matched'
  if (confidence >= 0.70) return 'review'
  return 'unmatched'
}

/**
 * Resolve an organization by external structured identifier.
 * Precedence: ein → sec_cik → dcca_file_number → fec_committee_id.
 * Returns the organization id + confidence=1.0 on exact hit, or null if none match.
 *
 * Callers should use this BEFORE falling back to fuzzy name matching via matchEntity().
 */
export async function matchOrganizationByExternalId(
  supabase: SupabaseClient,
  ids: {
    ein?: string | null
    sec_cik?: string | null
    dcca_file_number?: string | null
    fec_committee_id?: string | null
  }
): Promise<{ orgId: string; confidence: number } | null> {
  const ordered: [keyof typeof ids, string | null | undefined][] = [
    ['ein', ids.ein],
    ['sec_cik', ids.sec_cik],
    ['dcca_file_number', ids.dcca_file_number],
    ['fec_committee_id', ids.fec_committee_id],
  ]

  for (const [col, val] of ordered) {
    if (!val) continue
    const { data, error } = await supabase
      .from('organization')
      .select('id')
      .eq(col as string, val)
      .limit(1)
      .maybeSingle()
    if (error) continue
    if (data?.id) return { orgId: data.id, confidence: 1.0 }
  }
  return null
}
