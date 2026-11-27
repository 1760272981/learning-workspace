import type http from 'node:http'
import type { DatabaseClient } from '../functions/database.ts'

type Agent = {
  name: string
  listModels(options?: { live?: boolean }): Promise<{ id: string; label: string; cost?: number | null }[]>
  answer(context: { question: string; history: { text: string }[]; record: { title: string } }, model: string): Promise<{ text: string; model: string; requestId?: string }>
}

export function createLocalServer(options?: { db?: DatabaseClient, distDir?: string, port?: number, agents?: Record<string, Agent> }): http.Server & { localDataFile: string }
