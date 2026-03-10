import type { Operation } from '../../core/types'

/**
 * SQLite-based operation storage for nuxt-sync.
 *
 * Uses Nitro's built-in SQLite support via the `db0` connector.
 * In production, this can be swapped for D1, LibSQL, or PostgreSQL.
 */

export interface SyncStorage {
  initialize(): Promise<void>
  saveOperation(op: Operation): Promise<void>
  getOperations(docId: string): Promise<Operation[]>
  getAllDocIds(): Promise<string[]>
}

/**
 * In-memory storage for the PoC.
 * Replace with SQLite via db0 for production use.
 */
export function createMemoryStorage(): SyncStorage {
  const ops = new Map<string, Operation[]>()

  return {
    async initialize() {
      // No-op for memory storage
    },

    async saveOperation(op: Operation) {
      const docId = op.docId
      if (!ops.has(docId)) {
        ops.set(docId, [])
      }
      ops.get(docId)!.push(op)
    },

    async getOperations(docId: string) {
      return ops.get(docId) || []
    },

    async getAllDocIds() {
      return Array.from(ops.keys())
    },
  }
}

/**
 * SQLite storage using better-sqlite3 (for Node.js runtime).
 * This is the recommended storage for development and production.
 */
export function createSQLiteStorage(dbPath: string): SyncStorage {
  let db: any = null

  return {
    async initialize() {
      // Dynamic import to avoid bundling issues
      const Database = (await import('better-sqlite3')).default
      db = new Database(dbPath)

      db.exec(`
        CREATE TABLE IF NOT EXISTS sync_operations (
          id TEXT PRIMARY KEY,
          doc_id TEXT NOT NULL,
          type TEXT NOT NULL,
          payload TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          client_id TEXT NOT NULL,
          created_at INTEGER DEFAULT (unixepoch())
        )
      `)

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_sync_ops_doc_id
        ON sync_operations(doc_id)
      `)
    },

    async saveOperation(op: Operation) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO sync_operations (id, doc_id, type, payload, timestamp, client_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      stmt.run(op.id, op.docId, op.type, JSON.stringify(op), op.ts, op.clientId)
    },

    async getOperations(docId: string) {
      const rows = db.prepare(
        'SELECT payload FROM sync_operations WHERE doc_id = ? ORDER BY timestamp ASC, client_id ASC',
      ).all(docId) as Array<{ payload: string }>

      return rows.map(row => JSON.parse(row.payload) as Operation)
    },

    async getAllDocIds() {
      const rows = db.prepare(
        'SELECT DISTINCT doc_id FROM sync_operations',
      ).all() as Array<{ doc_id: string }>

      return rows.map(row => row.doc_id)
    },
  }
}
