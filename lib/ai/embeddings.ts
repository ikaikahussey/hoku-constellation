/**
 * Embeddings for retrieval (1024 dimensions, matching document.embedding / summary.embedding).
 * Any OpenAI-compatible endpoint: EMBEDDING_API_URL, EMBEDDING_API_KEY, EMBEDDING_MODEL.
 */
export const EMBEDDING_DIM = 1024
export type Embedder = (texts: string[]) => Promise<number[][]>

export function embeddingsConfigured(): boolean {
  return !!(process.env.EMBEDDING_API_URL && process.env.EMBEDDING_API_KEY && process.env.EMBEDDING_MODEL)
}

export function openAiCompatibleEmbedder(): Embedder {
  const url = process.env.EMBEDDING_API_URL, key = process.env.EMBEDDING_API_KEY, model = process.env.EMBEDDING_MODEL
  if (!url || !key || !model) throw new Error('EMBEDDING_API_URL, EMBEDDING_API_KEY and EMBEDDING_MODEL are required')
  return async (texts) => {
    const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, input: texts, dimensions: EMBEDDING_DIM, output_dimension: EMBEDDING_DIM }) })
    if (!res.ok) throw new Error(`embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const json = await res.json() as { data: Array<{ index: number; embedding: number[] }> }
    const out = json.data.sort((a, b) => a.index - b.index).map(d => d.embedding)
    for (const v of out) if (v.length !== EMBEDDING_DIM) throw new Error(`embedding dimension ${v.length}, expected ${EMBEDDING_DIM}`)
    return out
  }
}
