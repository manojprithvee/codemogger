/**
 * Approximate nearest-neighbour (ANN) index over chunk embeddings.
 *
 * The current storage engine (@tursodatabase/database) has no native vector
 * index, so semantic search falls back to a brute-force O(N) cosine scan in
 * SQL. This wraps hnswlib-node (HNSW) to provide a sub-linear ANN search built
 * in memory from the embeddings already persisted in SQLite — SQLite stays the
 * source of truth, the HNSW graph is a derived acceleration structure.
 */

// Minimal structural type for the parts of hnswlib-node we use.
interface HnswIndex {
  initIndex(maxElements: number, m?: number, efConstruction?: number, randomSeed?: number): void
  addPoint(point: number[], label: number): void
  searchKnn(query: number[], k: number): { distances: number[]; neighbors: number[] }
  setEf(ef: number): void
}
interface HnswModule {
  HierarchicalNSW: new (space: "cosine" | "l2" | "ip", dim: number) => HnswIndex
}

let hnswModule: HnswModule | null = null
async function loadHnsw(): Promise<HnswModule> {
  if (!hnswModule) {
    const mod = (await import("hnswlib-node")) as unknown as HnswModule & { default?: HnswModule }
    hnswModule = mod.default ?? mod
  }
  return hnswModule
}

export interface AnnItem {
  chunkKey: string
  embedding: number[]
}

export interface AnnBuildOptions {
  /** Max neighbours per node (graph connectivity). Higher = better recall, more memory. */
  m?: number
  /** Candidate-list size during construction. Higher = better recall, slower build. */
  efConstruction?: number
  /** Candidate-list size during search. Higher = better recall, slower query. */
  ef?: number
}

export interface AnnHit {
  chunkKey: string
  /** Cosine similarity in [-1, 1] (1 = identical), matching Store's score convention. */
  score: number
}

export class AnnIndex {
  private constructor(
    private readonly index: HnswIndex,
    private readonly labels: string[],
    readonly dim: number,
  ) {}

  /** Build an HNSW index from embeddings. Cost here is the "index creation" time. */
  static async build(items: AnnItem[], opts: AnnBuildOptions = {}): Promise<AnnIndex> {
    const { HierarchicalNSW } = await loadHnsw()
    const dim = items[0]?.embedding.length ?? 0
    const m = opts.m ?? 16
    const efConstruction = opts.efConstruction ?? 200
    const index = new HierarchicalNSW("cosine", dim)
    index.initIndex(Math.max(items.length, 1), m, efConstruction)

    const labels: string[] = new Array(items.length)
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!
      index.addPoint(item.embedding, i)
      labels[i] = item.chunkKey
    }
    index.setEf(opts.ef ?? Math.max(64, Math.ceil(efConstruction / 2)))
    return new AnnIndex(index, labels, dim)
  }

  /** Tune the query-time candidate-list size (recall/latency trade-off). */
  setEf(ef: number): void {
    this.index.setEf(ef)
  }

  get size(): number {
    return this.labels.length
  }

  /** Approximate top-k nearest neighbours, ordered by descending similarity. */
  search(query: number[], k: number): AnnHit[] {
    if (this.labels.length === 0) return []
    const kk = Math.min(k, this.labels.length)
    const res = this.index.searchKnn(query, kk)
    // hnswlib "cosine" space returns distance = 1 - cosineSimilarity.
    return res.neighbors.map((label, i) => ({
      chunkKey: this.labels[label]!,
      score: 1 - res.distances[i]!,
    }))
  }
}
