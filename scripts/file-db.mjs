import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDatabaseCore } from './db-core.mjs'

export const LOCAL_OWNER = '00000000-0000-4000-8000-000000000001'
export const DEFAULT_LOCAL_DATA_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'local-data', 'lw-local-db.json')

function cloneTables(tables) {
  return new Map([...tables].map(([name, rows]) => [name, rows.map((row) => structuredClone(row))]))
}

async function acquireLock(lockPath) {
  const deadline = Date.now() + 5000
  for (;;) {
    try {
      fs.mkdirSync(lockPath)
      return
    } catch (error) {
      if (error?.code !== 'EEXIST' || Date.now() >= deadline) throw new Error('local_database_busy')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
}

export function createFileDb(file = process.env.LW_LOCAL_DATA_FILE || DEFAULT_LOCAL_DATA_FILE) {
  const lockPath = `${file}.lock`
  const read = () => {
    let raw
    try {
      raw = fs.readFileSync(file, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return new Map()
      throw error
    }
    const parsed = JSON.parse(raw)
    if (parsed?.version !== 1 || !parsed.tables || typeof parsed.tables !== 'object' || Array.isArray(parsed.tables)) throw new Error('invalid_local_database')
    return new Map(Object.entries(parsed.tables).map(([name, rows]) => {
      if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('invalid_local_database')
      return [name, rows]
    }))
  }
  const write = (tables) => {
    const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
    try {
      const handle = fs.openSync(temp, 'wx')
      try {
        fs.writeFileSync(handle, JSON.stringify({ version: 1, tables: Object.fromEntries(cloneTables(tables)) }, null, 2), 'utf8')
        fs.fsyncSync(handle)
      } finally {
        fs.closeSync(handle)
      }
      fs.renameSync(temp, file)
    } finally {
      fs.rmSync(temp, { force: true })
    }
  }
  const transaction = async (run) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    await acquireLock(lockPath)
    try {
      return await run()
    } finally {
      fs.rmdirSync(lockPath)
    }
  }
  return createDatabaseCore({ read, write, transaction })
}
