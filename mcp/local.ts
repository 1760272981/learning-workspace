import { assembleStore } from '../functions/core.ts'
import { loadRows } from '../functions/database.ts'
import { submit } from '../functions/handler.ts'
import type { SubmitInput, SubmitResult } from '../shared/model.ts'
import { createFileDb, DEFAULT_LOCAL_DATA_FILE, LOCAL_OWNER } from '../scripts/file-db.mjs'

let localDb

export async function submitToLocal(input: SubmitInput): Promise<SubmitResult | { status: 'pending', pending: true, error: string, hints: string[] }> {
  try {
    localDb ||= createFileDb(process.env.LW_LOCAL_DATA_FILE || DEFAULT_LOCAL_DATA_FILE)
    return await submit(localDb, LOCAL_OWNER, input, new Date().toISOString())
  } catch {
    return { status: 'pending', pending: true, error: 'write_result_unknown', hints: ['本地数据文件未能确认写入结果，不要自动重发。先读取网页，按原 project + output_ref + 规范标题对账。'] }
  }
}

export async function readLocalStore() {
  localDb ||= createFileDb(process.env.LW_LOCAL_DATA_FILE || DEFAULT_LOCAL_DATA_FILE)
  return assembleStore(await loadRows(localDb, LOCAL_OWNER))
}
