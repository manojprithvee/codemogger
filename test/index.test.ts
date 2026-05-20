import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { CodeIndex } from "../src/index.ts";

let dir: string;

beforeEach(async () => {
  dir = join(tmpdir(), `codemogger-idx-${Date.now()}`);
  await mkdir(dir, { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeIndex(dbPath: string) {
  // Dummy embedder: returns a zero vector of the right dimension (384)
  const embedder = async (texts: string[]) =>
    texts.map(() => Array.from({ length: 384 }, () => 0));
  return new CodeIndex({ dbPath, embedder, embeddingModel: "test-model" });
}

test("indexes a directory and returns chunk count", async () => {
  await writeFile(join(dir, "foo.ts"), `
export function add(a: number, b: number): number {
  return a + b;
}
export function sub(a: number, b: number): number {
  return a - b;
}
  `);
  const dbPath = join(dir, "test.db");
  const idx = makeIndex(dbPath);
  const result = await idx.index(dir);
  expect(result.errors).toHaveLength(0);
  expect(result.chunks).toBeGreaterThan(0);
});

test("embedding batch errors are recorded in IndexResult.errors", async () => {
  await writeFile(join(dir, "foo.ts"), "export function hello() {}");
  const dbPath = join(dir, "test.db");
  let callCount = 0;
  const failingEmbedder = async (texts: string[]) => {
    callCount++;
    throw new Error("mock embed failure");
  };
  const idx = new CodeIndex({ dbPath, embedder: failingEmbedder, embeddingModel: "test-model" });
  const result = await idx.index(dir);
  // Should not throw; errors should be captured
  expect(result.errors.some(e => e.includes("mock embed failure"))).toBe(true);
  expect(callCount).toBeGreaterThan(0);
});

test("re-indexing unchanged files does not duplicate chunks", async () => {
  await writeFile(join(dir, "foo.ts"), "export function hello() {}");
  const dbPath = join(dir, "test.db");
  const idx = makeIndex(dbPath);
  const r1 = await idx.index(dir);
  const r2 = await idx.index(dir);
  // Second run: no new chunks (file hash unchanged, already skipped)
  expect(r2.skipped).toBe(1);
  expect(r1.chunks).toBeGreaterThan(0);
});
