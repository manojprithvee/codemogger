import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers"
import type { Embedder } from "./types.ts"

export const LOCAL_MODEL_NAME = "nomic-embed-text-v1.5"
const MODEL_ID = "nomic-ai/nomic-embed-text-v1.5"

// Nomic task prefixes separate document and query embedding spaces.
const DOC_PREFIX = "search_document: "
const QUERY_PREFIX = "search_query: "

// Smaller batch than MiniLM: 768-dim model is ~3× the memory per token.
const BATCH = 32

let _pipe: FeatureExtractionPipeline | null = null

async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (!_pipe) {
    _pipe = await pipeline("feature-extraction", MODEL_ID, { dtype: "q8" })
  }
  return _pipe
}

async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const pipe = await getPipeline()
  const results: number[][] = []
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH)
    const output = await pipe(batch, { pooling: "mean", normalize: true })
    results.push(...(output.tolist() as number[][]))
  }
  return results
}

/**
 * Document embedder — prepends the nomic search_document prefix so embeddings
 * land in the retrieval-document half of the model's dual embedding space.
 * Use this when indexing code chunks.
 */
export const localEmbed: Embedder = (texts) =>
  embed(texts.map((t) => DOC_PREFIX + t))

/**
 * Query embedder — prepends the nomic search_query prefix.
 * Use this when embedding a user's search query at retrieval time.
 */
export const localQueryEmbed: Embedder = (texts) =>
  embed(texts.map((t) => QUERY_PREFIX + t))
