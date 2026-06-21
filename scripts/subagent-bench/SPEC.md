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
