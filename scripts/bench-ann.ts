#!/usr/bin/env bun
/**
 * ANN vs brute-force benchmark.
 *
 * Measures the cost of semantic search WITHOUT an index (the current
 * brute-force `vector_distance_cos` scan in SQLite) versus WITH an HNSW ANN
 * index, covering both:
 *   - index creation (building the HNSW graph from stored embeddings), and
 *   - search latency (per query),
 * plus recall@k of the approximate results against the exact brute-force
 * ground truth.
 *
 * Usage:  bun scripts/bench-ann.ts            # defaults: N=20000
 *         N=50000 Q=30 K=10 bun scripts/bench-ann.ts
 */
import { connect } from "@tursodatabase/database"
import { rm } from "fs/promises"
import { Store } from "../src/db/store.ts"
import { AnnIndex } from "../src/search/ann.ts"
import { ALL_SCHEMA } from "../src/db/schema.ts"

const N = Number(process.env.N ?? 20000) // number of indexed chunks
const DIM = Number(process.env.DIM ?? 384) // embedding dimension (all-MiniLM-L6-v2)
const Q = Number(process.env.Q ?? 20) // number of benchmark queries
const K = Number(process.env.K ?? 10) // top-k

// Deterministic PRNG so runs are reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(rnd: () => number): number {
  const u1 = Math.max(rnd(), 1e-12)
  const u2 = rnd()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

function normalize(v: number[]): number[] {
  let norm = 0
  for (const x of v) norm += x * x
  norm = Math.sqrt(norm) || 1
  return v.map((x) => x / norm)
}

function randUnitVec(rnd: () => number): number[] {
  return normalize(Array.from({ length: DIM }, () => gaussian(rnd)))
}

// Real code embeddings are clustered (functions about similar things land near
// each other), not uniform on the sphere. Pure-random high-dim vectors are an
// adversarial worst case for ANN. We model structure as a mixture of Gaussians
// around CLUSTERS random centroids so recall reflects realistic data.
const CLUSTERS = Number(process.env.CLUSTERS ?? 200)
// Noise norm relative to the (unit) centroid. SPREAD=0.5 → within-cluster cosine
// similarity ≈ 0.9, typical of real sentence/code embeddings. The per-dimension
// std is divided by sqrt(DIM) so the total noise vector has norm ≈ SPREAD
// regardless of dimensionality.
const SPREAD = Number(process.env.SPREAD ?? 0.5)

function makeCentroids(rnd: () => number): number[][] {
  return Array.from({ length: CLUSTERS }, () => randUnitVec(rnd))
}

function clusteredVec(rnd: () => number, centroids: number[][]): number[] {
  const c = centroids[Math.floor(rnd() * centroids.length)]!
  const sigma = SPREAD / Math.sqrt(DIM)
  return normalize(c.map((x) => x + sigma * gaussian(rnd)))
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

async function main() {
  const dbPath = `/tmp/bench-ann-${N}-${DIM}.db`
  await rm(dbPath, { force: true }).catch(() => {})
  await rm(`${dbPath}-wal`, { force: true }).catch(() => {})

  console.log(`\nANN vs brute-force  —  N=${N} chunks, dim=${DIM}, queries=${Q}, k=${K}\n`)

  // ── Seed a DB with N synthetic chunk embeddings ──────────────────
  const rnd = mulberry32(42)
  const centroids = makeCentroids(rnd)
  const tSeed = performance.now()
  const raw = await connect(dbPath, { experimental: ["index_method"] })
  for (const sql of ALL_SCHEMA) await raw.exec(sql)
  await (await raw.prepare("INSERT INTO codebases (root_path, name, indexed_at) VALUES (?, ?, ?)"))
    .run("/bench", "bench", Date.now())

  const insert = await raw.prepare(
    `INSERT INTO chunks (codebase_id, file_path, chunk_key, language, kind, name, signature, snippet, start_line, end_line, file_hash, indexed_at, embedding, embedding_model)
     VALUES (1, ?, ?, 'ts', 'function', ?, '', '', 1, 1, 'h', 0, vector8(?), 'bench')`,
  )
  const SEED_BATCH = 2000
  for (let start = 0; start < N; start += SEED_BATCH) {
    await raw.exec("BEGIN")
    for (let i = start; i < Math.min(start + SEED_BATCH, N); i++) {
      await insert.run(`f${i}.ts`, `f${i}.ts:1:1`, `fn${i}`, JSON.stringify(clusteredVec(rnd, centroids)))
    }
    await raw.exec("COMMIT")
  }
  raw.close()
  console.log(`  seeded ${N} chunks in ${Math.round(performance.now() - tSeed)}ms`)

  // Build query set from the same clustered distribution (real queries land
  // near relevant code, not at uniformly random points).
  const queries = Array.from({ length: Q }, () => clusteredVec(rnd, centroids))

  const store = await Store.open(dbPath)

  // ── WITHOUT index: brute-force cosine scan (ground truth) ────────
  const bruteLatencies: number[] = []
  const bruteTopK: string[][] = []
  for (const q of queries) {
    const t = performance.now()
    const res = await store.vectorSearch(q, K, false)
    bruteLatencies.push(performance.now() - t)
    bruteTopK.push(res.map((r) => r.chunkKey))
  }

  // ── WITH index: build HNSW, then search ─────────────────────────
  const tLoad = performance.now()
  const items = await store.getAllEmbeddings()
  const loadMs = performance.now() - tLoad
  const tBuild = performance.now()
  const ann = await AnnIndex.build(items, { m: 16, efConstruction: 200, ef: 200 })
  const buildMs = performance.now() - tBuild

  const annLatencies: number[] = []
  const recalls: number[] = []
  for (let i = 0; i < queries.length; i++) {
    const t = performance.now()
    const hits = ann.search(queries[i]!, K)
    annLatencies.push(performance.now() - t)
    const got = new Set(hits.map((h) => h.chunkKey))
    const truth = bruteTopK[i]!
    const hit = truth.filter((key) => got.has(key)).length
    recalls.push(hit / truth.length)
  }

  store.close()

  // ── Report ───────────────────────────────────────────────────────
  const bruteAvg = avg(bruteLatencies)
  const annAvg = avg(annLatencies)
  const pad = (s: string, n: number) => s.padEnd(n)
  console.log(`\n  INDEX CREATION`)
  console.log(`    ${pad("without index (brute-force)", 32)} 0ms        (no build step)`)
  console.log(`    ${pad("with index (HNSW build)", 32)} ${Math.round(buildMs)}ms     (+ ${Math.round(loadMs)}ms to load embeddings from SQLite)`)
  console.log(`\n  SEARCH LATENCY  (avg over ${Q} queries, k=${K})`)
  console.log(`    ${pad("without index (brute-force)", 32)} ${bruteAvg.toFixed(2)}ms`)
  console.log(`    ${pad("with index (HNSW)", 32)} ${annAvg.toFixed(2)}ms`)
  console.log(`    ${pad("speedup", 32)} ${(bruteAvg / annAvg).toFixed(1)}x`)
  console.log(`\n  QUALITY`)
  console.log(`    ${pad(`recall@${K} (ANN vs exact)`, 32)} ${(avg(recalls) * 100).toFixed(1)}%`)
  console.log()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
