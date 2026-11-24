import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import {
  assembleStore,
  conceptUuid,
  isUuid,
  planSubmit,
  stableUuid,
  type ApplicationRow,
  type ConceptRow,
  type StoreRows,
} from '../functions/core.ts'
import { loadRows, insertConcept, DuplicateRowError } from '../functions/database.ts'
import { createApplication } from '../functions/routes.mjs'
import { createFakeDb, type FakeDbControl } from './fake-db.ts'
import { createFileDb, LOCAL_OWNER } from './file-db.mjs'
import { createLocalServer } from './local-server.mjs'
import { submitToLocal } from '../mcp/local.ts'
import type { SubmitInput } from '../shared/model.ts'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const ORIGIN = 'https://learning-workspace.test'
const SESSION_COOKIE = '__Host-lw_session'
const PASSWORD = `pw-${crypto.randomUUID()}-${crypto.randomUUID()}`
const ownerA = '11111111-1111-4111-8111-111111111111'
const ownerB = '22222222-2222-4222-8222-222222222222'
const conceptId = '33333333-3333-4333-8333-333333333333'
const otherId = '44444444-4444-4444-8444-444444444444'
const today = new Date().toISOString().slice(0, 10)
const base: SubmitInput = {
  project: 'p',
  output_ref: 'v1',
  title: '判断共享组件是否该提取',
  kind: 'concept',
  judging: '判断共同变更是否真的存在',
  evidence: '三处结构相同且同时修改',
  consequence: '盲目合并会增加回归范围',
  verify_action: '修改一处并检查其余页面',
  sources: [{ title: 'React', url: 'https://react.dev/learn' }],
  branch: '可维护性',
}

function concept(id = conceptId, title = base.title!): ConceptRow {
  return { id, owner_id: ownerA, project_id: 'p', title, kind: 'concept', branch: '可维护性', created_at: `${today}T00:00:00.000Z`, version: 1 }
}
function application(id: string, concept_id: string, output_ref: string, received_at = `${today}T01:00:00.000Z`): ApplicationRow {
  return {
    id,
    concept_id,
    output_ref,
    judging: base.judging!,
    evidence: base.evidence!,
    consequence: base.consequence!,
    verify_action: base.verify_action!,
    sources: base.sources as { title: string; url: string }[],
    created_at: '2026-01-01T00:00:00.000Z',
    received_at,
  }
}
function rows(values: Partial<StoreRows> = {}): StoreRows {
  return { concepts: [], applications: [], verifications: [], marks: [], ...values }
}

function fixture() {
  const control: FakeDbControl = { writes: [], dropTable: null, rejectTable: null }
  const db = createFakeDb(control)
  const handle = createApplication({ db, origin: ORIGIN })
  return { control, db, handle }
}

function ctx(path: string, { method = 'GET', body, rawBody, cookie, origin = ORIGIN, headers = {}, logical = false }: {
  method?: string
  body?: unknown
  rawBody?: string
  cookie?: string | null
  origin?: string | null
  headers?: Record<string, string>
  logical?: boolean
} = {}) {
  const merged = { ...headers }
  if (origin !== null) merged.origin = origin
  if (cookie) merged.cookie = cookie
  const hasBody = body !== undefined || rawBody !== undefined
  if (hasBody) merged['content-type'] = 'application/json'
  const target = logical
    ? `${ORIGIN}/functions/v1/app${path}`
    : `https://provider.internal/functions/v1/app-d${'a'.repeat(32)}${path}`
  return {
    request: new Request(target, {
      method,
      headers: merged,
      ...(hasBody ? { body: rawBody ?? JSON.stringify(body) } : {}),
    }),
    requestId: 'local-test',
  }
}

async function call(handle: ReturnType<typeof createApplication>, context: ReturnType<typeof ctx>) {
  const response = await handle(context)
  let body: unknown = null
  try { body = await response.clone().json() } catch { body = null }
  return { status: response.status, body: body as Record<string, any>, setCookie: response.headers.get('set-cookie'), headers: response.headers }
}

const cookiePair = (result: Awaited<ReturnType<typeof call>>) => result.setCookie?.split(';')[0] || null
const uniqueName = (prefix = 'user') => `${prefix}${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
const register = (handle: ReturnType<typeof createApplication>, username = uniqueName(), password = PASSWORD) => call(handle, ctx('/api/register', { method: 'POST', body: { username, password } }))
const login = (handle: ReturnType<typeof createApplication>, username: string, password = PASSWORD) => call(handle, ctx('/api/login', { method: 'POST', body: { username, password } }))
const me = (handle: ReturnType<typeof createApplication>, cookie: string | null) => call(handle, ctx('/api/me', { cookie }))
const store = (handle: ReturnType<typeof createApplication>, cookie: string | null) => call(handle, ctx('/api/store', { cookie }))
const action = (handle: ReturnType<typeof createApplication>, name: string, body: unknown, cookie: string | null, headers: Record<string, string> = {}) => call(handle, ctx(`/api/${name}`, { method: 'POST', body, cookie, headers }))

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

let passed = 0
async function check(label: string, run: () => void | Promise<void>) {
  await run()
  passed++
  console.log(`PASS ${label}`)
}

await check('函数模型副本与 shared/model.ts 完全一致', () => {
  assert.equal(fs.readFileSync(path.join(root, 'functions', 'model.ts'), 'utf8'), fs.readFileSync(path.join(root, 'shared', 'model.ts'), 'utf8'))
})

await check('概念 UUID 按 owner 隔离且可复现', async () => {
  const first = await conceptUuid(ownerA, 'p', base.title!)
  assert.ok(isUuid(first))
  assert.equal(first, await conceptUuid(ownerA, 'p', `  ${base.title!.toUpperCase()}  `))
  assert.notEqual(first, await conceptUuid(ownerB, 'p', base.title!))
  assert.notEqual(first, await stableUuid(['concept', ownerA, 'other-project', base.title!]))
})

await check('accepted 计划带 owner 且只写一条概念和一条应用', () => {
  const plan = planSubmit({ projects: {} }, base, conceptId, ownerA)
  assert.equal(plan.result.status, 'accepted')
  assert.equal(plan.concept?.owner_id, ownerA)
  assert.equal(plan.concept?.version, 1)
  assert.equal(plan.application?.concept_id, conceptId)
  assert.equal(plan.application?.received_at, '')
})

await check('同产出重试幂等且不重复写', () => {
  const first = planSubmit({ projects: {} }, base, conceptId, ownerA)
  const saved = rows({
    concepts: [first.concept!],
    applications: [{ ...first.application!, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', received_at: `${today}T02:00:00.000Z` }],
  })
  const retry = planSubmit(assembleStore(saved), base, conceptId, ownerA)
  assert.equal(retry.result.status, 'linked')
  assert.equal(retry.concept, null)
  assert.equal(retry.application, null)
})

await check('linked 新产出只计划新增应用', () => {
  const first = planSubmit({ projects: {} }, base, conceptId, ownerA)
  const saved = rows({
    concepts: [first.concept!],
    applications: [{ ...first.application!, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', received_at: `${today}T02:00:00.000Z` }],
  })
  const linked = planSubmit(assembleStore(saved), { ...base, output_ref: 'v2' }, conceptId, ownerA)
  assert.equal(linked.result.status, 'linked')
  assert.equal(linked.concept, null)
  assert.equal(linked.application?.output_ref, 'v2')
})

await check('上限按 output_ref 派生查询计数', () => {
  const saved = rows({
    concepts: [concept(), concept(otherId, '另一个概念')],
    applications: [
      application('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', conceptId, 'old'),
      application('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', otherId, 'v2'),
      application('cccccccc-cccc-4ccc-8ccc-cccccccccccc', otherId, 'v2'),
    ],
  })
  const plan = planSubmit(assembleStore(saved), { ...base, output_ref: 'v2' }, conceptId, ownerA)
  assert.equal(plan.result.status, 'over_limit')
  assert.equal(plan.result.scope, 'output')
})

await check('每日上限按每个概念首条应用的 received_at 日期统计', () => {
  const saved = rows({
    concepts: [concept(), concept(otherId, '另一个概念'), concept('55555555-5555-4555-8555-555555555555', '第三个概念')],
    applications: [
      application('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', conceptId, 'a'),
      application('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', otherId, 'b'),
      application('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '55555555-5555-4555-8555-555555555555', 'c'),
    ],
  })
  const store = assembleStore(saved)
  assert.equal(store.projects.p.days[today], 3)
  const plan = planSubmit(store, { ...base, title: '全新概念', output_ref: 'new' }, '66666666-6666-4666-8666-666666666666', ownerA)
  assert.equal(plan.result.status, 'over_limit')
  assert.equal(plan.result.scope, 'day')
})

await check('Store 拼装保留验收与标记，created_at 不参与每日计数', () => {
  const saved = rows({
    concepts: [concept()],
    applications: [application('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', conceptId, 'v1', `${today}T03:00:00.000Z`)],
    verifications: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', concept_id: conceptId, text: '亲自验证', created_at: `${today}T04:00:00.000Z` }],
    marks: [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', owner_id: ownerA, project_id: 'p', concept_id: conceptId, status: 'understood', updated_at: `${today}T05:00:00.000Z` }],
  })
  const store = assembleStore(saved)
  assert.equal(store.projects.p.days[today], 1)
  assert.equal(store.projects.p.concepts[0].verifications?.[0].text, '亲自验证')
  assert.equal(store.projects.p.marks?.[conceptId], 'understood')
})

await check('注册签发安全会话，密码与令牌明文不落库', async () => {
  const { db, handle } = fixture()
  const created = await register(handle, '  Alpha_01  ')
  assert.equal(created.status, 201)
  assert.equal(created.body.user.username, 'alpha_01')
  const cookie = cookiePair(created)!
  assert.ok(cookie.startsWith(`${SESSION_COOKIE}=`))
  assert.match(created.setCookie!, /HttpOnly/)
  assert.match(created.setCookie!, /Secure/)
  assert.match(created.setCookie!, /SameSite=Lax/)
  assert.match(created.setCookie!, /Path=\//)
  const token = cookie.slice(SESSION_COOKIE.length + 1)
  const users = db.dump('lw_users')
  const sessions = db.dump('lw_sessions')
  assert.equal(users.length, 1)
  assert.equal(users[0].password_iterations, 600000)
  assert.ok(!JSON.stringify([...users, ...sessions, ...db.dump('lw_auth_limiter')]).includes(PASSWORD))
  assert.ok(!JSON.stringify(sessions).includes(token))
  assert.equal(sessions[0].token_digest, await sha256Hex(token))
  assert.equal((await me(handle, cookie)).body.user.username, 'alpha_01')
})

await check('重复注册返回 409，大小写与空白使用同一用户名', async () => {
  const { handle } = fixture()
  const name = uniqueName('bravo')
  assert.equal((await register(handle, name)).status, 201)
  const duplicate = await register(handle, ` ${name.toUpperCase()} `)
  assert.equal(duplicate.status, 409)
  assert.equal(duplicate.body.error, 'username_taken')
})

await check('错密码与不存在账号都返回固定 401', async () => {
  const { handle } = fixture()
  const name = uniqueName()
  await register(handle, name)
  const wrong = await login(handle, name, `${PASSWORD}-wrong`)
  const unknown = await login(handle, uniqueName('ghost'))
  assert.equal(wrong.status, 401)
  assert.equal(unknown.status, 401)
  assert.deepEqual(wrong.body, { error: 'invalid_credentials' })
  assert.deepEqual(unknown.body, wrong.body)
})

await check('未登录业务口与令牌管理均返回 401', async () => {
  const { handle } = fixture()
  assert.equal((await store(handle, null)).status, 401)
  assert.equal((await action(handle, 'submit', base, null)).status, 401)
  assert.equal((await call(handle, ctx('/api/tokens'))).status, 401)
  assert.equal((await call(handle, ctx('/api/tokens', { method: 'POST', body: { label: 'x' } }))).status, 401)
})

await check('过期会话返回 401，成功登录清理本人过期会话', async () => {
  const { db, handle } = fixture()
  const name = uniqueName()
  const created = await register(handle, name)
  const expiredToken = 'A'.repeat(43)
  const expiredDigest = await sha256Hex(expiredToken)
  await db.from('lw_sessions').insertIfAbsent({
    token_digest: expiredDigest,
    user_id: created.body.user.id,
    created_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    expires_at: new Date(Date.now() - 1000).toISOString(),
  }, { onConflict: 'token_digest' }).select('token_digest')
  const expired = await me(handle, `${SESSION_COOKIE}=${expiredToken}`)
  assert.equal(expired.status, 401)
  assert.equal(expired.body.error, 'session_expired')
  assert.match(expired.setCookie!, /Max-Age=0/)
  assert.equal((await login(handle, name)).status, 200)
  assert.ok(!db.dump('lw_sessions').some((row) => row.token_digest === expiredDigest))
})

await check('登出吊销当前会话并清除 Cookie', async () => {
  const { db, handle } = fixture()
  const created = await register(handle)
  const cookie = cookiePair(created)!
  const result = await call(handle, ctx('/api/logout', { method: 'POST', cookie }))
  assert.equal(result.status, 200)
  assert.match(result.setCookie!, /Max-Age=0/)
  assert.ok(db.dump('lw_sessions').some((row) => row.revoked_at != null))
  assert.equal((await me(handle, cookie)).status, 401)
})

await check('个人令牌创建、列表、Bearer 使用与吊销', async () => {
  const { db, handle } = fixture()
  const cookie = cookiePair(await register(handle))!
  const created = await call(handle, ctx('/api/tokens', { method: 'POST', cookie, body: { label: '本地测试 agent' } }))
  assert.equal(created.status, 201)
  const token = created.body.token as string
  assert.match(token, /^[A-Za-z0-9_-]{43}$/)
  assert.ok(!JSON.stringify(db.dump('lw_tokens')).includes(token))
  const listed = await call(handle, ctx('/api/tokens', { cookie }))
  assert.equal(listed.status, 200)
  assert.equal(listed.body.tokens.length, 1)
  assert.ok(!JSON.stringify(listed.body).includes(token))
  const bearer = { authorization: `Bearer ${token}` }
  assert.equal((await call(handle, ctx('/api/store', { headers: bearer }))).status, 200)
  const id = listed.body.tokens[0].id as string
  assert.equal((await call(handle, ctx(`/api/tokens/${id}`, { method: 'DELETE', cookie }))).status, 200)
  const revoked = await call(handle, ctx('/api/store', { headers: bearer }))
  assert.equal(revoked.status, 401)
  assert.equal(revoked.body.error, 'token_revoked')
})

await check('双用户读写删隔离，跨 owner concept 全部 404', async () => {
  const { handle } = fixture()
  const a = await register(handle, uniqueName('alpha'))
  const b = await register(handle, uniqueName('bravo'))
  const cookieA = cookiePair(a)!
  const cookieB = cookiePair(b)!
  const createdA = await action(handle, 'submit', { ...base, owner_id: b.body.user.id }, cookieA)
  const createdB = await action(handle, 'submit', base, cookieB)
  assert.equal(createdA.status, 200)
  assert.equal(createdB.status, 200)
  const nodeA = createdA.body.node_id as string
  const nodeB = createdB.body.node_id as string
  assert.notEqual(nodeA, nodeB)
  assert.deepEqual((await store(handle, cookieA)).body.projects.p.concepts.map((item: { id: string }) => item.id), [nodeA])
  assert.deepEqual((await store(handle, cookieB)).body.projects.p.concepts.map((item: { id: string }) => item.id), [nodeB])
  for (const name of ['mark', 'verify', 'delete']) {
    const body = name === 'mark' ? { project: 'p', concept_id: nodeA, status: 'understood' } : name === 'verify' ? { project: 'p', concept_id: nodeA, text: '越权验收' } : { project: 'p', concept_id: nodeA }
    const denied = await action(handle, name, body, cookieB)
    assert.equal(denied.status, 404)
    assert.equal(denied.body.error, 'concept_not_found')
  }
  assert.equal((await action(handle, 'delete', { project: 'p', concept_id: nodeA }, cookieA)).status, 200)
  assert.equal((await store(handle, cookieA)).body.projects.p?.concepts?.length || 0, 0)
  assert.equal((await store(handle, cookieB)).body.projects.p.concepts.length, 1)
})

await check('owner 幂等：同标题不同 owner 不冲突，同 owner 重试不增行', async () => {
  const { db, handle } = fixture()
  const a = cookiePair(await register(handle, uniqueName('alpha')))!
  const b = cookiePair(await register(handle, uniqueName('bravo')))!
  const first = await action(handle, 'submit', base, a)
  const second = await action(handle, 'submit', base, b)
  const retry = await action(handle, 'submit', base, a)
  assert.equal(first.body.status, 'accepted')
  assert.equal(second.body.status, 'accepted')
  assert.equal(retry.body.status, 'linked')
  assert.equal(retry.body.node_id, first.body.node_id)
  assert.equal(db.dump('lw_concepts').length, 2)
  assert.equal(db.dump('lw_applications').length, 2)
})

await check('产出上限与每日上限按 owner 独立', async () => {
  const { handle } = fixture()
  const a = cookiePair(await register(handle, uniqueName('alpha')))!
  const b = cookiePair(await register(handle, uniqueName('bravo')))!
  assert.equal((await action(handle, 'submit', { ...base, title: 'A1', output_ref: 'same' }, a)).body.status, 'accepted')
  assert.equal((await action(handle, 'submit', { ...base, title: 'A2', output_ref: 'same' }, a)).body.status, 'accepted')
  assert.equal((await action(handle, 'submit', { ...base, title: 'A3', output_ref: 'same' }, a)).body.scope, 'output')
  assert.equal((await action(handle, 'submit', { ...base, title: 'B1', output_ref: 'same' }, b)).body.status, 'accepted')
  assert.equal((await action(handle, 'submit', { ...base, title: 'A4', output_ref: 'day-a' }, a)).body.status, 'accepted')
  assert.equal((await action(handle, 'submit', { ...base, title: 'A5', output_ref: 'day-b' }, a)).body.scope, 'day')
  assert.equal((await action(handle, 'submit', { ...base, title: 'B2', output_ref: 'day-b' }, b)).body.status, 'accepted')
})

await check('登录固定窗口限流触发 429', async () => {
  const { handle } = fixture()
  const name = uniqueName()
  await register(handle, name)
  for (let index = 0; index < 10; index++) {
    const result = await login(handle, name, `${PASSWORD}-wrong`)
    assert.equal(result.status, 401)
  }
  const blocked = await login(handle, name)
  assert.equal(blocked.status, 429)
  assert.equal(blocked.body.error, 'rate_limited')
  assert.ok(Number(blocked.headers.get('retry-after')) > 0)
})

await check('Origin 校验与 32KB 上限保留', async () => {
  const { db, handle } = fixture()
  const cookie = cookiePair(await register(handle))!
  const noOrigin = await call(handle, ctx('/api/submit', { method: 'POST', body: base, cookie, origin: null }))
  assert.equal(noOrigin.status, 403)
  assert.equal(noOrigin.body.error, 'origin_forbidden')
  const foreign = await call(handle, ctx('/api/submit', { method: 'POST', body: base, cookie, origin: 'https://evil.test' }))
  assert.equal(foreign.status, 403)
  const oversized = await call(handle, ctx('/api/submit', { method: 'POST', rawBody: 'x'.repeat(32 * 1024 + 1), cookie }))
  assert.equal(oversized.status, 413)
  assert.equal(oversized.body.error, 'payload_too_large')
  assert.equal(db.dump('lw_concepts').length, 0)
})

await check('received_at 由服务器盖章，请求中的 owner 与时间不生效', async () => {
  const { db, handle } = fixture()
  const a = await register(handle, uniqueName('alpha'))
  const b = await register(handle, uniqueName('bravo'))
  const before = Date.now()
  const result = await action(handle, 'submit', { ...base, owner_id: b.body.user.id, received_at: '2000-01-01T00:00:00.000Z', created_at: '2000-01-01T00:00:00.000Z' }, cookiePair(a)!)
  assert.equal(result.status, 200)
  const savedConcept = db.dump('lw_concepts')[0]
  const savedApplication = db.dump('lw_applications')[0]
  assert.equal(savedConcept.owner_id, a.body.user.id)
  assert.ok(Date.parse(String(savedApplication.received_at)) >= before)
  assert.notEqual(savedApplication.received_at, '2000-01-01T00:00:00.000Z')
  const loaded = await loadRows(db, a.body.user.id)
  assert.equal(loaded.concepts.length, 1)
  assert.equal(loaded.applications.length, 1)
  assert.equal((await loadRows(db, b.body.user.id)).concepts.length, 0)
})

await check('写入结果未知只尝试一次，不自动重放', async () => {
  const { control, db, handle } = fixture()
  const cookie = cookiePair(await register(handle))!
  control.dropTable = 'lw_concepts'
  const result = await action(handle, 'submit', base, cookie)
  assert.equal(result.status, 503)
  assert.equal(result.body.error, 'database_request_failed')
  assert.equal(control.writes.filter((table) => table === 'lw_concepts').length, 1)
  assert.equal(db.dump('lw_concepts').length, 1)
  assert.equal(db.dump('lw_applications').length, 0)
})

async function withTempDb(run: (file: string) => Promise<void>) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lw-block3-'))
  try {
    await run(path.join(tmp, 'nested', 'lw-local-db.json'))
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

async function startLocal(file: string) {
  const db = createFileDb(file)
  const server = createLocalServer({ db, port: 0, distDir: path.join(root, 'dist') })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('local_server_address_missing')
  const base = `http://127.0.0.1:${address.port}`
  return { db, server, origin: base }
}

async function stopLocal(server: ReturnType<typeof createLocalServer>) {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

async function localRequest(base: string, pathname: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${pathname}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(10000) })
  const body = await response.json() as Record<string, any>
  return { status: response.status, body }
}

await check('file-db 原子持久化，重建实例读回且唯一冲突为 23505', async () => {
  await withTempDb(async (file) => {
    const first = createFileDb(file)
    await insertConcept(first, concept())
    assert.ok(fs.existsSync(file))
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['lw-local-db.json'])
    const restarted = createFileDb(file)
    const loaded = await loadRows(restarted, ownerA)
    assert.equal(loaded.concepts.length, 1)
    assert.equal(loaded.concepts[0].id, conceptId)
    await assert.rejects(insertConcept(restarted, concept()), DuplicateRowError)
    assert.equal((await loadRows(restarted, ownerA)).concepts.length, 1)
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['lw-local-db.json'])
  })
})

await check('本地路由 me/health 正常，认证路由 404 安全码且拒绝外来 Origin', async () => {
  await withTempDb(async (file) => {
    const { server, origin } = await startLocal(file)
    try {
      assert.deepEqual((await localRequest(origin, '/api/me')).body, { user: { id: LOCAL_OWNER, username: 'local' }, mode: 'local' })
      assert.equal((await localRequest(origin, '/api/health')).status, 200)
      for (const route of ['register', 'login', 'logout', 'tokens']) {
        const result = await localRequest(origin, `/api/${route}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' })
        assert.equal(result.status, 404)
        assert.deepEqual(result.body, { error: 'local_mode_only' })
      }
      const forbidden = await localRequest(origin, '/api/submit', { method: 'POST', headers: { Origin: 'http://evil.test', 'Content-Type': 'application/json' }, body: JSON.stringify(base) })
      assert.equal(forbidden.status, 403)
      assert.deepEqual(forbidden.body, { error: 'origin_forbidden' })
    } finally {
      await stopLocal(server)
    }
  })
})

await check('本地固定 LOCAL_OWNER 幂等，五动作、32KB 与 received_at 语义保留', async () => {
  await withTempDb(async (file) => {
    const { db, server, origin } = await startLocal(file)
    const post = (action: string, body: unknown) => localRequest(origin, `/functions/v1/app/api/${action}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    try {
      const empty = await localRequest(origin, '/api/store')
      assert.deepEqual(empty.body, { projects: {} })
      const before = Date.now()
      const created = await post('submit', { ...base, owner_id: ownerB, received_at: '2000-01-01T00:00:00.000Z' })
      assert.equal(created.body.status, 'accepted')
      const id = created.body.node_id as string
      assert.equal((await post('submit', base)).body.status, 'linked')
      assert.equal((await db.dump('lw_concepts')).length, 1)
      assert.equal((await db.dump('lw_concepts'))[0].owner_id, LOCAL_OWNER)
      assert.ok(Date.parse(String((await db.dump('lw_applications'))[0].received_at)) >= before)
      assert.equal((await post('mark', { project: 'p', concept_id: id, status: 'understood' })).status, 200)
      assert.equal((await post('verify', { project: 'p', concept_id: id, text: '本地真实验收' })).status, 200)
      const saved = await localRequest(origin, '/api/store')
      assert.equal(saved.body.projects.p.marks[id], 'understood')
      assert.equal(saved.body.projects.p.concepts[0].verifications[0].text, '本地真实验收')
      const oversized = await localRequest(origin, '/api/submit', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...base, evidence: 'x'.repeat(33 * 1024) }) })
      assert.equal(oversized.status, 413)
      assert.equal((await post('delete', { project: 'p', concept_id: id })).status, 200)
      assert.deepEqual((await localRequest(origin, '/api/store')).body, { projects: {} })
    } finally {
      await stopLocal(server)
    }
  })
})

await check('MCP stdio 与本地网页共用文件，agent 提交后 store 立即可见且重启保留', async () => {
  await withTempDb(async (file) => {
    const { server, origin } = await startLocal(file)
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, 'mcp', 'server.ts')],
      env: { ...process.env, LW_LOCAL_DATA_FILE: file, LW_USER_TOKEN: '', LW_API_BASE: '' },
    })
    const client = new Client({ name: 'lw-block3-unified', version: '0.1.0' })
    try {
      await client.connect(transport)
      const response = await client.callTool({ name: 'submit_learning_block', arguments: { ...base } })
      const submitted = JSON.parse((response.content as { type: string, text: string }[])[0].text) as { status: string, node_id: string }
      assert.equal(submitted.status, 'accepted')
      const visible = await localRequest(origin, '/api/store')
      assert.equal(visible.body.projects.p.concepts[0].id, submitted.node_id)
      assert.equal(visible.body.projects.p.concepts[0].title, base.title)
    } finally {
      await client.close()
      await stopLocal(server)
    }
    const restarted = await loadRows(createFileDb(file), LOCAL_OWNER)
    assert.equal(restarted.concepts.length, 1)
    assert.equal(restarted.applications.length, 1)
  })
})

await check('file-db 默认构造读取 LW_LOCAL_DATA_FILE，避免本地进程写入不同文件', async () => {
  await withTempDb(async (file) => {
    const previous = process.env.LW_LOCAL_DATA_FILE
    process.env.LW_LOCAL_DATA_FILE = file
    try {
      await insertConcept(createFileDb(), concept())
      assert.ok(fs.existsSync(file))
      assert.equal((await loadRows(createFileDb(), ownerA)).concepts.length, 1)
    } finally {
      if (previous === undefined) delete process.env.LW_LOCAL_DATA_FILE
      else process.env.LW_LOCAL_DATA_FILE = previous
    }
  })
})

await check('MCP 本地写入结果无法确认时返回 pending，不伪装失败或自动重发', async () => {
  await withTempDb(async (file) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const previous = process.env.LW_LOCAL_DATA_FILE
    process.env.LW_LOCAL_DATA_FILE = path.dirname(file)
    try {
      const result = await submitToLocal(base)
      assert.equal(result.status, 'pending')
      assert.equal((result as { pending?: boolean }).pending, true)
      assert.match(JSON.stringify(result), /不要自动重发/)
    } finally {
      if (previous === undefined) delete process.env.LW_LOCAL_DATA_FILE
      else process.env.LW_LOCAL_DATA_FILE = previous
    }
  })
})

await check('本地静态服务提供唯一提示词且阻断路径穿越', async () => {
  await withTempDb(async (file) => {
    const { server, origin } = await startLocal(file)
    try {
      const response = await fetch(`${origin}/setup-prompt.txt`)
      assert.equal(response.status, 200)
      assert.equal(await response.text(), fs.readFileSync(path.join(root, 'public', 'setup-prompt.txt'), 'utf8'))
      const escaped = await fetch(`${origin}/%2e%2e%2fpackage.json`)
      assert.equal(escaped.status, 404)
    } finally {
      await stopLocal(server)
    }
  })
})

console.log(`\nFUNCTIONS MULTIUSER ${passed} PASS`)
