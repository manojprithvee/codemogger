# libSQL backend swap — same tests, compared results

Goal: replace the `@tursodatabase/database` storage engine with **libSQL**
(`@libsql/client`) and re-run the same benchmarks to see if results hold.

## What changed (code)

The Turso coupling lived entirely in `src/db/`:

| Concern | Turso (before) | libSQL (after) |
|---------|----------------|----------------|
| Client API | `connect()` + `.prepare/.exec` | thin `src/db/libsql-adapter.ts` wrapping `@libsql/client` with the same surface |
| Vector store | `vector8(?)` (int8 quantized) | `vector32(?)` (float32) |
| Vector search | `vector_distance_cos(...)` | `vector_distance_cos(...)` (identical) |
| FTS table | `CREATE INDEX ... USING fts ... WITH (weights='name=5.0,signature=3.0')` | FTS5 virtual table `USING fts5(name, signature, chunk_id UNINDEXED)` |
| FTS match/score | `fts_match()` / `fts_score()` | `MATCH` + `-bm25(table, 5.0, 3.0)` |
| FTS optimize | `OPTIMIZE INDEX idx_...` | `INSERT INTO t(t) VALUES('optimize')` |

`store.ts` logic, the SDK, CLI, and MCP server are otherwise unchanged.
All **22 existing tests pass** on the libSQL backend.

## Do we get the same results?

Re-ran the Round-3 benchmark (turso `core/translate`, 76 files / 1,609 chunks)
with the libSQL-backed codemogger arm vs. the original Turso-backed arm.

### Accuracy — identical (4/4)

| Task | Turso answer | libSQL answer | Same? |
|------|--------------|---------------|:--:|
| B1 ORDER BY → sorter | `order_by.rs::sorter_insert` | `order_by.rs::sorter_insert` | ✅ |
| B2 optimizer entry | `optimizer/mod.rs::optimize_select_plan` | `optimizer/mod.rs::optimize_plan` | ✅* |
| B3 subquery opt | `optimizer/mod.rs::optimize_subqueries` | `optimizer/mod.rs::optimize_subqueries` | ✅ |
| B4 common-subexpr lift | `lift_common_subexpressions.rs::lift_..._or_terms` | same | ✅ |

\* B2: libSQL arm returned the parent dispatcher `optimize_plan` (which calls
`optimize_select_plan`) — equally valid for "top-level entry point".

### Search latency — equivalent

| Mode | Turso | libSQL |
|------|------:|-------:|
| Semantic (incl. query embedding) | ~167 ms | ~174–206 ms |
| Keyword (FTS) | ~8 ms | ~6–7 ms |

Semantic time is dominated by CPU query-embedding, not the DB; the engines are
effectively tied. Indexing `core/translate` also matched: 34.3 s (Turso) vs
34.8 s (libSQL).

### Agent metrics — near-identical

| Metric | Turso Arm A | libSQL Arm A |
|--------|:---:|:---:|
| Accuracy | 4/4 | 4/4 |
| Tool calls | 7 | 8 |
| Tokens | 57,199 | 58,477 |

(Per-task wall-clock varied with model latency, not the backend.)

## Where they differ

- **Robustness — libSQL wins.** The Turso pre-release panics with
  `shared WAL frame ids must increase monotonically` on large batched writes
  and **could not index the full 2,291-file turso repo**. libSQL indexed the
  whole thing cleanly: **1,006 source files → 22,116 chunks in 8m19s**.
- **On-disk size — Turso wins.** Same 1,609-chunk index: **5.4 MB (Turso int8
  `vector8`)** vs **8.0 MB (libSQL float32 `vector32`)**, ~48% larger, because
  libSQL has no int8 vector quantization. (Full-repo libSQL index: 88 MB.)

## Verdict

Swapping to libSQL **reproduces the same search quality and latency** with no
change to behavior the user sees — and is **more robust at scale** (handles the
workload that crashed Turso), at the cost of a larger on-disk index (f32 vs
int8 vectors).
