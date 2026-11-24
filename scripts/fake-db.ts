import type { DbRow } from '../functions/database.ts'
import { createDatabaseCore, type DatabaseControl } from './db-core.mjs'

export type FakeDbControl = DatabaseControl

export function createFakeDb(control: FakeDbControl = { writes: [], dropTable: null, rejectTable: null }) {
  const tables = new Map<string, DbRow[]>()
  const db = createDatabaseCore({
    control,
    read: async () => new Map([...tables].map(([name, rows]) => [name, rows.map((row) => ({ ...row }))])),
    write: async (next) => {
      tables.clear()
      for (const [name, rows] of next) tables.set(name, rows)
    },
  })
  return { ...db, dump: (table: string) => (tables.get(table) || []).map((row) => ({ ...row })) }
}
