/** SQL statements for initializing the codemogger code index schema */

export const CREATE_CODEBASES_TABLE = `
CREATE TABLE IF NOT EXISTS codebases (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    root_path   TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL DEFAULT '',
    indexed_at  INTEGER NOT NULL DEFAULT 0
)
`

export const CREATE_CHUNKS_TABLE = `
CREATE TABLE IF NOT EXISTS chunks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    codebase_id     INTEGER NOT NULL REFERENCES codebases(id),
    file_path       TEXT NOT NULL,
    chunk_key       TEXT NOT NULL UNIQUE,
    language        TEXT NOT NULL,
    kind            TEXT NOT NULL,
    name            TEXT NOT NULL DEFAULT '',
    signature       TEXT NOT NULL DEFAULT '',
    snippet         TEXT NOT NULL,
    start_line      INTEGER NOT NULL,
    end_line        INTEGER NOT NULL,
    file_hash       TEXT NOT NULL,
    indexed_at      INTEGER NOT NULL,
    embedding       BLOB,
    embedding_model TEXT DEFAULT ''
)
`

export const CREATE_FILES_TABLE = `
CREATE TABLE IF NOT EXISTS indexed_files (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    codebase_id INTEGER NOT NULL REFERENCES codebases(id),
    file_path   TEXT NOT NULL,
    file_hash   TEXT NOT NULL,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    indexed_at  INTEGER NOT NULL,
    UNIQUE(codebase_id, file_path)
)
`

/** Generate DDL for a per-codebase FTS table */
export function ftsTableName(codebaseId: number): string {
  return `fts_${codebaseId}`
}

export function createFtsTableSQL(codebaseId: number): string {
  const table = ftsTableName(codebaseId)
  // libSQL/SQLite FTS5 virtual table. Field weighting (name > signature) is
  // applied at query time via bm25(table, 5.0, 3.0) rather than in the DDL.
  return `
CREATE VIRTUAL TABLE IF NOT EXISTS ${table} USING fts5(
    name,
    signature,
    chunk_id UNINDEXED
)
`
}

export function createFtsIndexSQL(_codebaseId: number): string {
  // FTS5 needs no separate index — the virtual table is the index. No-op for
  // libSQL; kept for API compatibility with the previous Turso backend.
  return ""
}

export function dropFtsTableSQL(codebaseId: number): string {
  return `DROP TABLE IF EXISTS ${ftsTableName(codebaseId)}`
}

export function populateFtsSQL(codebaseId: number): string {
  const table = ftsTableName(codebaseId)
  return `
INSERT INTO ${table} (name, signature, chunk_id)
SELECT name, signature, id FROM chunks WHERE codebase_id = ?
`
}

/** Insert FTS entries for chunks of a single file (used by incremental update) */
export function populateFtsForFileSQL(codebaseId: number): string {
  const table = ftsTableName(codebaseId)
  return `
INSERT INTO ${table} (name, signature, chunk_id)
SELECT name, signature, id FROM chunks WHERE codebase_id = ? AND file_path = ?
`
}

// Core tables (FTS is per-codebase, created dynamically)
export const ALL_SCHEMA = [CREATE_CODEBASES_TABLE, CREATE_CHUNKS_TABLE, CREATE_FILES_TABLE]
