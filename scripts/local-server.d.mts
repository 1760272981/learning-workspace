import type http from 'node:http'
import type { DatabaseClient } from '../functions/database.ts'

export function createLocalServer(options?: { db?: DatabaseClient, distDir?: string, port?: number }): http.Server & { localDataFile: string }
