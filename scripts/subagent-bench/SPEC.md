# Sub-agent benchmark: codemogger vs. no-codemogger

Each task is a natural-language code-location question about codemogger's own
codebase. Two arms run the *same* task:

- **Arm A (codemogger):** may only use `bun bin/codemogger.ts search "..."` to locate code.
- **Arm B (baseline):** may only use grep/glob/read (no codemogger).

Metrics: correctness (matches ground truth), tool-call count, wall-clock.

## Tasks + ground truth

| ID | Question | Expected file | Expected symbol |
|----|----------|---------------|-----------------|
| T1 | Where is the directory walk that respects .gitignore and SHA-256 hashes files for incremental indexing? | src/scan/walker.ts | scanDirectory / createHash sha256 |
| T2 | Where are embeddings stored int8-quantized and cosine vector search run? | src/db/store.ts | vector8 / vector_distance_cos |
| T3 | Where are discriminative keywords extracted from a natural-language prompt? | src/search/query.ts | extractKeywords / QueryMode |
| T4 | Where is the MCP server's search tool defined? | src/mcp.ts | codemogger_search tool |

## Round 2 — harder tasks (conceptual / cross-file / adversarial keyword)

| ID | Question | Expected file | Expected symbol | Why hard |
|----|----------|---------------|-----------------|----------|
| H1 | How are the two search modes fused into one ranking, and what constant discounts lower-ranked hits? | src/search/rank.ts | rrfMerge (RRF, k=60) | "fusion"/"RRF" not an obvious grep term |
| H2 | Where does indexing skip unchanged files to avoid re-embedding? | src/index.ts | CodeIndex.index (getFileHash vs file.hash, ~L136) | cross-file: hash from store.ts, decision in index.ts |
| H3 | What makes a chunk's name weigh more than its signature in keyword search? | src/db/schema.ts | createFtsIndexSQL (weights name=5.0,signature=3.0) | adversarial: "weight" also lives in rrfMerge |
| H4 | How are multiple codebases isolated for FTS in one shared SQLite file? | src/db/schema.ts | ftsTableName / createFtsTableSQL (per-codebase fts_{id}) | concept of isolation, no single keyword |
