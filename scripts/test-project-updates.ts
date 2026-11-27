// 项目事件最小闭环测试。
// 证明范围：本地真实 MCP stdio + 本地文件库 + 本地 HTTP 服务 + 内存假库故障注入。
// 云端部分仅为 fetch mock 契约，不证明真实云端；真实云端待部署后另行验收。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import { verificationFreshness, type ProjectEvent, type ProjectUpdateInput } from '../shared/model.ts'
import { projectEventUuid } from '../functions/core.ts'
import { findEvent, loadEvents } from '../functions/database.ts'
import { submitProjectUpdate } from '../functions/handler.ts'
import { createApplication } from '../functions/routes.mjs'
import { createFakeDb, type FakeDbControl } from './fake-db.ts'
import { createFileDb } from './file-db.mjs'
import { createLocalServer } from './local-server.mjs'
import { readUpdatesFromCloud, submitUpdateToCloud } from '../mcp/cloud.ts'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const ORIGIN = 'https://learning-workspace.test'
const PASSWORD = `pw-${crypto.randomUUID()}-${crypto.randomUUID()}`
const ownerA = '11111111-1111-4111-8111-111111111111'
const ownerB = '22222222-2222-4222-8222-222222222222'

let passed = 0
let failed = 0
function check(ok: boolean, label: string, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (ok) passed++
  else failed++
}

function baseInput(overrides: Partial<ProjectUpdateInput> = {}): ProjectUpdateInput {
  return {
    project: 'p',
    task_id: 'task-1',
    run_id: 'run-1',
    task_title: '修复示例缺陷',
    source_revision: { type: 'git-commit', ref: 'abc1234' },
    agent_report: '已完成修改并自测（自报，不等于验证通过）',
    changes: [{ target: 'mcp/server.ts', summary: '修正配置路由', kind: 'code', sync: 'updated' }],
    decisions: [{ decision: '保持本地默认', reason: '不引入新依赖' }],
    verifications: [
      { item: 'npm run test:mcp', status: 'verified', revision: 'abc1234', environment: 'Node 24 / Windows', scope: '21 项 MCP 自测', evidence: 'ALL PASS（测试输出）' },
      { item: '云端真实提交读回', status: 'unverified' },
    ],
    risks: [{ text: '云端路径未验', kind: 'unknown' }],
    learning_candidates: [],
    ...overrides,
  }
}

function ctx(pathname: string, { method = 'GET', body, cookie, origin = ORIGIN, headers = {} }: {
  method?: string; body?: unknown; cookie?: string | null; origin?: string; headers?: Record<string, string>
} = {}) {
  const h = new Headers({ origin, ...headers })
  if (body !== undefined) h.set('content-type', 'application/json')
  if (cookie) h.set('cookie', cookie)
  const request = new Request(`${ORIGIN}/functions/v1/app${pathname}`, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { request }
}

function cookieFrom(response: Response): string {
  const raw = response.headers.get('set-cookie') || ''
  return raw.split(';')[0]
}

// ---- 一、真实 MCP stdio：正常提交 / 部分验证 / 零学习候选 / 重复提交 / 读回 ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lw-updates-test-'))
const dataPath = path.join(tmp, 'lw-local-db.json')
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, 'mcp', 'server.ts')],
  env: { ...process.env, LW_LOCAL_DATA_FILE: dataPath, LW_USER_TOKEN: '', LW_API_BASE: '', LW_WRITE_KEY: '' },
})
const client = new Client({ name: 'lw-updates-test', version: '0.1.0' })
await client.connect(transport)

async function callTool(name: string, args: object) {
  const res = await client.callTool({ name, arguments: args as Record<string, unknown> })
  return JSON.parse((res.content as { type: string; text: string }[])[0].text)
}

const tools = await client.listTools()
check(tools.tools.some((t) => t.name === 'submit_project_update'), 'listTools 包含 submit_project_update')
check(tools.tools.some((t) => t.name === 'read_project_updates'), 'listTools 包含 read_project_updates')
check(tools.tools.some((t) => t.name === 'submit_learning_block'), '学习点工具保留')

const first = await callTool('submit_project_update', baseInput())
check(first.status === 'accepted' && typeof first.event_id === 'string', '用例1 正常提交返回事件 ID', first.event_id)
const eventId: string = first.event_id

const readBack = await callTool('read_project_updates', { project: 'p', task_id: 'task-1', run_id: 'run-1' })
check(readBack.status === 'ok' && readBack.events.length === 1 && readBack.events[0].id === eventId, 'MCP 读回同一条事件')
const ev: ProjectEvent = readBack.events[0]
check(ev.verifications[0].status === 'verified' && ev.verifications[1].status === 'unverified', '用例2 部分验证：一项实测一项未验证分别保存')
check(ev.verifications[0].evidence!.includes('ALL PASS') && ev.verifications[0].environment!.includes('Node'), '验证证据与环境保留')
check(ev.acceptance === null, '用户验收保持未记录（null）')
check(Array.isArray(ev.learning_candidates) && ev.learning_candidates.length === 0, '用例3 零学习候选照常保存')
check(ev.agent_report.includes('自报') && ev.source_revision.ref === 'abc1234', 'Agent 报告与版本绑定保留')

const dup = await callTool('submit_project_update', baseInput())
check(dup.status === 'duplicate' && dup.event_id === eventId, '用例4 相同身份与内容重送返回原事件')
const afterDup = await callTool('read_project_updates', { project: 'p' })
check(afterDup.events.length === 1, '重复提交后仍只有一条记录')

const conflict = await callTool('submit_project_update', baseInput({ agent_report: '内容变了' }))
check(conflict.status === 'conflict' && conflict.event_id === eventId, '同身份不同内容返回 conflict 不覆盖')

const withOutcome = await callTool('submit_project_update', baseInput({
  run_id: 'run-with-outcome',
  outcome: '你现在可以在项目更新页看到每轮任务的改动与证据',
}))
const outcomeRead = await callTool('read_project_updates', { run_id: 'run-with-outcome' })
check(withOutcome.status === 'accepted' && outcomeRead.events[0]?.outcome === '你现在可以在项目更新页看到每轮任务的改动与证据', '带 outcome 提交 accepted 且读回原样保留')

const withoutOutcome = await callTool('submit_project_update', baseInput({ run_id: 'run-without-outcome' }))
check(withoutOutcome.status === 'accepted', '不带 outcome 的旧输入仍 accepted（向后兼容）')

const outcomeConflict = await callTool('submit_project_update', baseInput({
  run_id: 'run-with-outcome',
  outcome: '用户现在能看到另一句结果',
}))
check(outcomeConflict.status === 'conflict' && outcomeConflict.event_id === withOutcome.event_id, '同身份仅 outcome 不同返回 conflict（hash 覆盖 outcome）')

const invalid = await callTool('submit_project_update', baseInput({
  run_id: 'run-bad',
  verifications: [{ item: '没跑过的测试', status: 'verified' }],
}))
check(invalid.status === 'invalid' && invalid.missing.includes('verifications[0].evidence'), 'verified 缺证据被拒绝（声明不能伪装成通过）')

const inferred = await callTool('submit_project_update', baseInput({
  run_id: 'run-inferred',
  changes: [{ target: 'src/App.tsx', summary: '可能受影响', kind: 'code', sync: 'inferred' }],
}))
check(inferred.status === 'accepted', '推断影响可提交')
const inferredRead = await callTool('read_project_updates', { run_id: 'run-inferred' })
check(inferredRead.events[0].changes[0].sync === 'inferred', '推断影响标为待查（inferred）不被改成已更新')

// ---- 二、本地 HTTP 服务：跨进程读回 + 重启持久化 ----
const server1 = createLocalServer({ db: createFileDb(dataPath), distDir: path.join(root, 'dist'), port: 0 })
await new Promise<void>((resolve) => server1.listen(0, '127.0.0.1', resolve))
const port1 = (server1.address() as { port: number }).port
const httpRead = await (await fetch(`http://127.0.0.1:${port1}/api/updates`)).json() as { events: ProjectEvent[] }
check(httpRead.events.some((e) => e.id === eventId), '用例1 网页 API 跨进程读回 MCP 提交的事件', `port ${port1}`)
await new Promise<void>((resolve) => server1.close(() => resolve()))

const server2 = createLocalServer({ db: createFileDb(dataPath), distDir: path.join(root, 'dist'), port: 0 })
await new Promise<void>((resolve) => server2.listen(0, '127.0.0.1', resolve))
const port2 = (server2.address() as { port: number }).port
const restartRead = await (await fetch(`http://127.0.0.1:${port2}/api/updates?project=p&task_id=task-1&run_id=run-1`)).json() as { events: ProjectEvent[] }
check(restartRead.events.length === 1 && restartRead.events[0].id === eventId, '重启服务后按原身份仍读回同一条（刷新等价）')
const acceptResp = await fetch(`http://127.0.0.1:${port2}/api/accept`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port2}` },
  body: JSON.stringify({ project: 'p', event_id: eventId, decision: 'accepted', note: '本地测试验收' }),
})
const acceptBody = await acceptResp.json() as { ok?: boolean, acceptance?: { status: string } }
check(acceptResp.status === 200 && acceptBody.ok === true && acceptBody.acceptance?.status === 'accepted', '本地用户验收写入成功')
const afterAccept = await (await fetch(`http://127.0.0.1:${port2}/api/updates?event_id=${eventId}`)).json() as { events: ProjectEvent[] }
check(afterAccept.events[0].acceptance?.status === 'accepted' && afterAccept.events[0].acceptance?.note === '本地测试验收', '验收状态读回（测试数据，真实事件验收留给用户）')
await new Promise<void>((resolve) => server2.close(() => resolve()))
await client.close()

// ---- 三、内存假库：回执丢失对账 / owner 隔离 / 认证与验收权限 ----
const control: FakeDbControl = { writes: [], dropTable: null, rejectTable: null }
const fakeDb = createFakeDb(control)
const now = new Date().toISOString()

const okPlan = await submitProjectUpdate(fakeDb, ownerA, baseInput(), now)
check(okPlan.status === 'accepted', '假库正常提交')

// 服务端保存成功但响应丢失：dropTable 在写入后抛错
control.dropTable = 'lw_events'
let lost = false
try {
  await submitProjectUpdate(fakeDb, ownerA, baseInput({ run_id: 'run-lost' }), now)
} catch {
  lost = true
}
check(lost, '用例5 写入后响应丢失表现为错误（客户端应视为结果未知）')
const lostId = await projectEventUuid(ownerA, 'p', 'task-1', 'run-lost')
const recovered = await findEvent(fakeDb, ownerA, lostId)
check(recovered !== null && recovered.id === lostId, '按原提交身份查回已保存事件（服务端实际已写入）')
const retry = await submitProjectUpdate(fakeDb, ownerA, baseInput({ run_id: 'run-lost' }), now)
check(retry.status === 'duplicate' && retry.event_id === lostId, '对账后重提返回原事件，不产生第二条')
check((await loadEvents(fakeDb, ownerA)).filter((e) => e.run_id === 'run-lost').length === 1, '丢失场景最终只有一条记录')

check((await loadEvents(fakeDb, ownerB)).length === 0, 'owner 隔离：B 读不到 A 的事件')

// HTTP 认证路由
const handle = createApplication({ db: fakeDb, origin: ORIGIN })
const anonUpdates = await handle(ctx('/api/updates'))
check(anonUpdates.status === 401, '未登录读取项目更新 401')
const anonUpdate = await handle(ctx('/api/update', { method: 'POST', body: baseInput() }))
check(anonUpdate.status === 401, '未登录提交项目更新 401')

const regA = await handle(ctx('/api/register', { method: 'POST', body: { username: `upd_a_${crypto.randomUUID().slice(0, 8)}`, password: PASSWORD } }))
check(regA.status === 201, '注册 A 成功')
const cookieA = cookieFrom(regA)
const regB = await handle(ctx('/api/register', { method: 'POST', body: { username: `upd_b_${crypto.randomUUID().slice(0, 8)}`, password: PASSWORD } }))
const cookieB = cookieFrom(regB)

const submitA = await handle(ctx('/api/update', { method: 'POST', body: baseInput({ run_id: 'run-http' }), cookie: cookieA }))
const submitABody = await submitA.json() as { status: string, event_id?: string }
check(submitA.status === 200 && submitABody.status === 'accepted', '会话提交项目更新 accepted')
const httpEventId = submitABody.event_id!

const acceptBearerless = await handle(ctx('/api/accept', { method: 'POST', body: { project: 'p', event_id: httpEventId, decision: 'accepted' }, headers: { authorization: 'Bearer ' + 'x'.repeat(43) } }))
check(acceptBearerless.status === 401, '个人令牌（agent）不能代记用户验收')

const acceptB = await handle(ctx('/api/accept', { method: 'POST', body: { project: 'p', event_id: httpEventId, decision: 'accepted' }, cookie: cookieB }))
check(acceptB.status === 404, '跨 owner 验收 404')

const acceptA = await handle(ctx('/api/accept', { method: 'POST', body: { project: 'p', event_id: httpEventId, decision: 'accepted', note: '亲自核对' }, cookie: cookieA }))
const acceptABody = await acceptA.json() as { ok?: boolean }
check(acceptA.status === 200 && acceptABody.ok === true, '会话用户本人验收成功')

const listB = await handle(ctx('/api/updates', { cookie: cookieB }))
const listBBody = await listB.json() as { events: ProjectEvent[] }
check(listBBody.events.length === 0, 'B 的项目更新列表为空（隔离）')

// ---- 四、证据版本归属 ----
const v1Event: ProjectEvent = { ...ev }
check(verificationFreshness(ev.verifications[0], v1Event) === 'current', '用例6 V1 证据在 V1 事件中标为当前版本')
const v2Event: ProjectEvent = { ...ev, source_revision: { type: 'git-commit', ref: 'def5678' } }
check(verificationFreshness(ev.verifications[0], v2Event) === 'stale', 'V2 事件引用 V1 证据显示待复验（不自动继承）')
check(verificationFreshness({ item: 'x', status: 'verified' }, v2Event) === 'unversioned', '未注明版本的通过证据可辨认')
check(verificationFreshness(ev.verifications[1], v2Event) === 'unverified', '未验证项保持未验证')

// ---- 五、云端契约（fetch mock，不证明真实云端） ----
const cloudConfig = { apiBase: 'https://example.invalid/functions/v1/app', userToken: crypto.randomUUID(), timeoutMs: 50 }
const cloudOk = await submitUpdateToCloud(baseInput(), {
  ...cloudConfig,
  fetchImpl: async (url, init) => {
    assert.equal(new URL(url.toString()).searchParams.get('action'), 'update')
    const h = new Headers(init?.headers)
    assert.equal(h.get('Authorization'), `Bearer ${cloudConfig.userToken}`)
    assert.equal(h.get('Origin'), 'https://example.invalid')
    return Response.json({ status: 'accepted', event_id: 'e1', hints: [] })
  },
})
check(cloudOk.status === 'accepted', '云提交契约：action=update + Bearer + Origin')
const cloudPending = await submitUpdateToCloud(baseInput(), { ...cloudConfig, fetchImpl: async () => { throw new DOMException('aborted', 'TimeoutError') } })
check(cloudPending.status === 'pending' && (cloudPending as { pending?: boolean }).pending === true, '云提交超时 pending 不自动重发')
const cloudRead = await readUpdatesFromCloud({ project: 'p', task_id: 'task-1', run_id: 'run-1' }, {
  ...cloudConfig,
  fetchImpl: async (url) => {
    const u = new URL(url.toString())
    assert.equal(u.searchParams.get('action'), 'updates')
    assert.equal(u.searchParams.get('run_id'), 'run-1')
    return Response.json({ events: [{ id: 'e1' }] })
  },
})
check(cloudRead.status === 'ok' && cloudRead.events.length === 1, '云读回契约：按原身份查询')

fs.rmSync(tmp, { recursive: true, force: true })
console.log(failed === 0 ? `\nPROJECT UPDATES ${passed} PASS` : `\n${failed} FAIL / ${passed} PASS`)
process.exit(failed === 0 ? 0 : 1)