# Sub-agent benchmark results: codemogger vs. no-codemogger

Ran codemogger on its own codebase. For each task, two identical sub-agents
(`general-purpose`) raced to locate code. **Arm A** could only use the
codemogger CLI search; **Arm B** could only use grep/glob/read. All eight
agents ran in parallel. Index built once: `bun bin/codemogger.ts index .`
→ 32 files, 191 chunks, ~7.9 s (one-time).

## Per-task results

| Task | Arm | Correct? | Tool calls | Tokens | Wall-clock |
|------|-----|:---:|:---:|---:|---:|
| T1 walker/gitignore+sha256 | A codemogger | ✅ | 2 | 14,955 | 12.6 s |
| T1 | B baseline | ✅ | 2 | 14,603 | 11.4 s |
| T2 int8 store + cosine search | A codemogger | ✅ | 3 | 17,176 | 16.2 s |
| T2 | B baseline | ✅ | 3 | 20,257 | 13.6 s |
| T3 extractKeywords | A codemogger | ✅ | 1 | 13,585 | 8.6 s |
| T3 | B baseline | ✅ | 2 | 14,591 | 10.0 s |
| T4 MCP search tool | A codemogger | ✅ | 2 | 14,724 | 8.3 s |
| T4 | B baseline | ✅ | 3 | 14,772 | 8.1 s |

## Aggregate

| Metric | Arm A (codemogger) | Arm B (baseline) |
|--------|:---:|:---:|
| Accuracy | 4/4 | 4/4 |
| Total tool calls | **8** | 10 |
| Avg tool calls/task | **2.0** | 2.5 |
| Total tokens | **60,440** | 64,223 |
| Avg tokens/task | **15,110** | 16,056 |
| Total wall-clock | 45.6 s | **43.2 s** |

## Takeaways

- **Both arms were 100% accurate.** On a 32-file repo, locating code is easy
  either way — grep is more than capable at this scale.
- **codemogger used ~20% fewer tool calls and ~6% fewer tokens.** A single
  semantic query tends to return the exact definition (often in one shot,
  e.g. T3), whereas the baseline iterates grep → narrow → read.
- **Baseline was marginally faster in wall-clock** (~2.4 s total) because each
  codemogger CLI invocation pays Bun startup + embedding-model load, while
  ripgrep over 32 files is near-instant.
- **The crossover favors codemogger as the codebase grows.** Per the project's
  own README benchmarks, on a 39k-file repo ripgrep takes ~1.5 s/query and
  matches thousands of files, while codemogger returns the top-5 definitions
  in ~240 ms — that's where the tool-call/token savings compound. This repo is
  too small to show that gap.

## Reproduce

```bash
bun install
bun bin/codemogger.ts index .
# then dispatch the paired sub-agents per SPEC.md
```

---

# Round 2 results — harder tasks

Same A/B setup, but conceptual / cross-file / adversarial-keyword questions.
Tool-call counts below are the authoritative `tool_uses` from agent telemetry
(agents' self-counts were occasionally off).

| Task | Arm | Correct? | Tool calls | Tokens | Wall-clock |
|------|-----|:---:|:---:|---:|---:|
| H1 RRF fusion (k=60) | A codemogger | ✅ | 3 | 15,891 | 15.9 s |
| H1 | B baseline | ✅ | 3 | 14,229 | 24.4 s |
| H2 incremental skip (cross-file) | A codemogger | ✅ | 6 | 19,294 | 37.7 s |
| H2 | B baseline | ✅ | 5 | 15,248 | 20.2 s |
| H3 name>signature weight (adversarial) | A codemogger | ✅ | 6 | 18,785 | 39.5 s |
| H3 | B baseline | ✅ | 13 | 23,460 | 57.3 s |
| H4 per-codebase FTS isolation | A codemogger | ✅ | 3 | 16,824 | 19.7 s |
| H4 | B baseline | ✅ | 4 | 17,004 | 19.0 s |

## Aggregate (Round 2)

| Metric | Arm A (codemogger) | Arm B (baseline) |
|--------|:---:|:---:|
| Accuracy | 4/4 | 4/4 |
| Total tool calls | **18** | 25 |
| Total tokens | 70,794 | **69,941** |
| Total wall-clock | **112.8 s** | 120.9 s |

## What the hard tasks revealed

- **Adversarial keywords are where codemogger pulls ahead (H3).** The word
  "weight" appears in BOTH `rrfMerge` (fusion weights) and the FTS DDL
  (`name=5.0,signature=3.0`). The grep arm thrashed — **13 tool calls, 23.5k
  tokens, 57 s** chasing the wrong "weight" first. The codemogger arm's
  semantic query landed on the FTS index in 6 calls. This is the headline win.
- **Clean keyword-y cross-file questions can favor grep (H2).** "skip /
  unchanged / hash" are literal tokens, so `rg` jumped straight to
  `index.ts`; the codemogger arm found the right region but over-verified
  (6 vs 5 calls). Semantic search doesn't help when the keyword is obvious.
- **Both arms stayed 100% accurate** even on conceptual questions (RRF,
  per-codebase isolation). H4 even surfaced two equally-valid answers:
  `schema.ts::ftsTableName` (where the tables are defined) and
  `store.ts::ftsSearch` (where isolation is enforced at query time).
- **Net:** tool calls 18 vs 25 (~28% fewer with codemogger); tokens and
  wall-clock roughly tied on this tiny repo. The advantage concentrates in
  ambiguous/adversarial lookups and would widen on a large codebase where
  grep returns thousands of matches.
