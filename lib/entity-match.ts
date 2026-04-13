function normalize(name: string): string {
  return name
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
