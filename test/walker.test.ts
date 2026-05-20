import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm, symlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { scanDirectory } from "../src/scan/walker.ts";

let dir: string;

beforeEach(async () => {
  dir = join(tmpdir(), `codemogger-test-${Date.now()}`);
  await mkdir(dir, { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("finds TypeScript files", async () => {
  await writeFile(join(dir, "a.ts"), "export const x = 1;");
  await writeFile(join(dir, "b.ts"), "export const y = 2;");
  const { files, errors } = await scanDirectory(dir);
  expect(errors).toHaveLength(0);
  expect(files.map(f => f.relPath).sort()).toEqual(["a.ts", "b.ts"]);
});

test("skips files above 1MB", async () => {
  await writeFile(join(dir, "big.ts"), "x".repeat(1_100_000));
  await writeFile(join(dir, "small.ts"), "export const x = 1;");
  const { files } = await scanDirectory(dir);
  expect(files.map(f => f.relPath)).toEqual(["small.ts"]);
});

test("respects .gitignore patterns", async () => {
  await writeFile(join(dir, ".gitignore"), "ignored/\n");
  await mkdir(join(dir, "ignored"));
  await writeFile(join(dir, "ignored", "secret.ts"), "export const s = 1;");
  await writeFile(join(dir, "visible.ts"), "export const v = 1;");
  const { files } = await scanDirectory(dir);
  expect(files.map(f => f.relPath)).toEqual(["visible.ts"]);
});

test("does not follow directory symlinks", async () => {
  const target = join(tmpdir(), `codemogger-link-target-${Date.now()}`);
  await mkdir(target);
  await writeFile(join(target, "hidden.ts"), "export const h = 1;");
  await symlink(target, join(dir, "link"));
  await writeFile(join(dir, "real.ts"), "export const r = 1;");
  try {
    const { files } = await scanDirectory(dir);
    expect(files.map(f => f.relPath)).toEqual(["real.ts"]);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("does not follow file symlinks", async () => {
  const target = join(tmpdir(), `codemogger-file-target-${Date.now()}.ts`);
  await writeFile(target, "export const h = 1;");
  await symlink(target, join(dir, "link.ts"));
  await writeFile(join(dir, "real.ts"), "export const r = 1;");
  try {
    const { files } = await scanDirectory(dir);
    expect(files.map(f => f.relPath)).toEqual(["real.ts"]);
  } finally {
    await rm(target, { force: true });
  }
});

test("reports unreadable .gitignore as error", async () => {
  // Write a directory named .gitignore so readFile() throws EISDIR
  await mkdir(join(dir, ".gitignore"));
  await writeFile(join(dir, "a.ts"), "export const x = 1;");
  const { errors } = await scanDirectory(dir);
  expect(errors.some(e => e.includes(".gitignore"))).toBe(true);
});

test("filters by language", async () => {
  await writeFile(join(dir, "a.ts"), "export const x = 1;");
  await writeFile(join(dir, "b.rs"), "fn main() {}");
  const { files } = await scanDirectory(dir, ["typescript"]);
  expect(files.map(f => f.relPath)).toEqual(["a.ts"]);
});
