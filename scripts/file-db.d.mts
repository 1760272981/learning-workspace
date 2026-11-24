import type { DatabaseClient, DbRow } from '../functions/database.ts'

export const LOCAL_OWNER: '00000000-0000-4000-8000-000000000001'
export const DEFAULT_LOCAL_DATA_FILE: string
export function createFileDb(file?: string): DatabaseClient & { dump(table: string): Promise<DbRow[]> }
