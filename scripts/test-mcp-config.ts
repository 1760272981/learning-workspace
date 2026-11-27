// 回归：配置了 LW_API_BASE 但缺凭证时，三个工具都必须明确报配置错误，
// 绝不静默回落本地写文件（审查包 B1 缺陷的修复验证）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lw-config-test-'))
const dataPath = path.join(tmp, 'lw-local-db.json')

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, 'mcp', 'server.ts')],
  env: { ...process.env, LW_LOCAL_DATA_FILE: dataPath, LW_API_BASE: 'https://example.invalid/functions/v1/app', LW_USER_TOKEN: '', LW_WRITE_KEY: '' },
})
const client = new Client({ name: 'lw-config-test', version: '0.1.0' })
await client.connect(transport)

let failed = 0
function check(ok: boolean, label: string, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed++
}

async function call(name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args })
  return JSON.parse((res.content as { type: string; text: string }[])[0].text)
}

const learning = await call('submit_learning_block', { project: 'p', output_ref: 'v1', title: 't', kind: 'concept', judging: 'j', evidence: 'e', consequence: 'c', verify_action: 'v', sources: [{ title: 's', url: 'https://example.com' }] })
check(learning.status === 'failed' && learning.error === 'cloud_credentials_missing', '学习点工具：缺凭证明确报错', learning.error)

const update = await call('submit_project_update', { project: 'p', task_id: 't', run_id: 'r', task_title: 'x', source_revision: { type: 'git-commit', ref: 'abc' }, agent_report: 'a', changes: [{ target: 'f', summary: 's' }], verifications: [{ item: 'i', status: 'unverified' }] })
check(update.status === 'failed' && update.error === 'cloud_credentials_missing', '项目更新工具：缺凭证明确报错', update.error)

const read = await call('read_project_updates', {})
check(read.status === 'failed' && read.error === 'cloud_credentials_missing', '读取工具：缺凭证明确报错', read.error)

check(!fs.existsSync(dataPath), '本地数据文件未被静默创建（没有回落本地写入）')

await client.close()
fs.rmSync(tmp, { recursive: true, force: true })
console.log(failed === 0 ? '\nMCP CONFIG GUARD ALL PASS' : `\n${failed} FAIL`)
process.exit(failed === 0 ? 0 : 1)