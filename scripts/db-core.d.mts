import type { DatabaseClient, DbRow, QueryResult } from '../functions/database.ts'

export interface DatabaseControl {
  writes: string[]
  dropTable: string | null
  rejectTable: string | null
}

export interface DatabaseCoreOptions {
  read: () => Map<string, DbRow[]> | Promise<Map<string, DbRow[]>>
  write: (tables: Map<string, DbRow[]>) => void | Promise<void>
  transaction?: (run: () => Promise<QueryResult>) => Promise<QueryResult>
  control?: DatabaseControl
}

export function createDatabaseCore(options: DatabaseCoreOptions): DatabaseClient & { dump(table: string): Promise<DbRow[]> }
