/**
 * libSQL adapter.
 *
 * Exposes the same minimal surface that Store relies on from
 * `@tursodatabase/database` (`connect()` → `.prepare()/.exec()/.close()`,
 * where a prepared statement has `.get()/.all()/.run()`), implemented on top
 * of `@libsql/client`. This lets the rest of the codebase stay unchanged
 * while the storage engine is swapped from Turso to libSQL.
 */
import { createClient, type Client } from "@libsql/client"

type Args = unknown[]

class PreparedStatement {
  constructor(private client: Client, private sql: string) {}

  async get(...args: Args): Promise<unknown> {
    const res = await this.client.execute({ sql: this.sql, args: args as never })
    return res.rows[0]
  }

  async all(...args: Args): Promise<unknown[]> {
    const res = await this.client.execute({ sql: this.sql, args: args as never })
    return res.rows as unknown[]
  }

  async run(...args: Args): Promise<void> {
    await this.client.execute({ sql: this.sql, args: args as never })
  }
}

class Connection {
  constructor(private client: Client) {}

  prepare(sql: string): PreparedStatement {
    return new PreparedStatement(this.client, sql)
  }

  async exec(sql: string): Promise<void> {
    await this.client.execute(sql)
  }

  close(): void {
    this.client.close()
  }
}

/**
 * Open a libSQL database file. The `opts` argument is accepted for API
 * compatibility with the Turso `connect()` signature and is ignored — libSQL
 * needs no experimental flags for our use.
 */
export async function connect(path: string, _opts?: unknown): Promise<Connection> {
  const url = path.startsWith("file:") ? path : `file:${path}`
  const client = createClient({ url })
  return new Connection(client)
}
