import { test, expect } from "bun:test"
import { AnnIndex } from "../src/search/ann.ts"

const DIM = 64

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

function unitVec(rnd: () => number): number[] {
  const v = Array.from({ length: DIM }, () => rnd() - 0.5)
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1
  return v.map((x) => x / norm)
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!
  return dot
}

test("AnnIndex returns approximate nearest neighbours matching brute force", async () => {
  const rnd = mulberry32(7)
  const n = 500
  const items = Array.from({ length: n }, (_, i) => ({
    chunkKey: `chunk-${i}`,
    embedding: unitVec(rnd),
  }))

  const ann = await AnnIndex.build(items, { m: 16, efConstruction: 200, ef: 128 })
  expect(ann.size).toBe(n)

  const k = 10
  let recallSum = 0
  const trials = 20
  for (let t = 0; t < trials; t++) {
    const query = unitVec(rnd)

    // Brute-force ground truth: top-k by cosine similarity.
    const truth = items
      .map((it) => ({ key: it.chunkKey, score: cosine(query, it.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((x) => x.key)

    const hits = ann.search(query, k)
    expect(hits.length).toBe(k)
    // Scores must be ordered descending (most similar first).
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i]!.score).toBeLessThanOrEqual(hits[i - 1]!.score + 1e-6)
    }

    const got = new Set(hits.map((h) => h.chunkKey))
    recallSum += truth.filter((key) => got.has(key)).length / k
  }

  // HNSW is approximate, but recall should be high on this small set.
  expect(recallSum / trials).toBeGreaterThan(0.9)
})

test("AnnIndex handles empty input", async () => {
  const ann = await AnnIndex.build([])
  expect(ann.size).toBe(0)
  expect(ann.search([0, 0, 0], 5)).toEqual([])
})
