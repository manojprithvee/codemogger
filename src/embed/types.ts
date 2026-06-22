/** A function that takes texts and returns their embedding vectors */
export type Embedder = (texts: string[]) => Promise<number[][]>

export interface EmbedderConfig {
  embedder?: Embedder
  /** Separate embedder for query-time (e.g. nomic search_query: prefix). Falls back to embedder if omitted. */
  queryEmbedder?: Embedder
  embeddingModel?: string
}
