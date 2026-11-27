import assert from 'node:assert/strict'
import { once } from 'node:events'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createFileDb, LOCAL_OWNER } from './file-db.mjs'
import { insertAnswer, insertQuestion, listChat } from './chat-store.mjs'
import { createLocalServer } from './local-server.mjs'
import { submitProjectUpdate } from '../functions/handler.ts'

const temp = mkdtempSync(join(tmpdir(), 'lw-chat-test-'))
const file = join(temp, 'test.json')
const cloudFile = join(temp, 'cloud.json')
const db = createFileDb(file)
const server = createLocalServer({ db, port: 0, agents: {} })
const startClient = (name: string) => new Client({ name, version: '0.1.0' })
const local = startClient('lw-chat-local-test')
const cloud = startClient('lw-chat-cloud-test')
const transport = (file: string, base = '') => new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../mcp/server.ts', import.meta.url))],
  env: { ...process.env, LW_LOCAL_DATA_FILE: file, LW_API_BASE: base, LW_USER_TOKEN: '', LW_WRITE_KEY: '' },
})
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args })
  assert.equal(result.isError, undefined)
  return JSON.parse((result.content as { text: string }[])[0].text)
}
let checks = 0
const check = (ok: boolean, label: string) => { assert.ok(ok, label); checks++; console.log(`PASS ${label}`) }

try {
  const event = await submitProjectUpdate(db, LOCAL_OWNER, {
    project: 'p', task_id: 'task', run_id: 'run', task_title: '测试事件',
    source_revision: { type: 'git-commit', ref: 'abc' }, agent_report: '测试记录',
    changes: [{ target: 'app', summary: '示例' }], verifications: [{ item: '未执行', status: 'unverified' }],
  }, new Date().toISOString())
  assert.equal(event.status, 'accepted')
  assert.ok(event.event_id)
  const eventId = event.event_id
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const ask = (question: string, id = eventId, origin = base) => fetch(`${base}/api/ask`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ event_id: id, question }),
  })
  const chat = async () => (await (await fetch(`${base}/api/chat?event_id=${eventId}`)).json()).messages
  check((await ask('问题', crypto.randomUUID())).status === 404, '不存在的事件不能提问')
  check((await ask(' ')).status === 400, '空消息被拒绝')
  check((await ask('字'.repeat(2001))).status === 400, '超过上限的消息被拒绝')
  check((await ask('问题', eventId, 'http://example.invalid')).status === 403, '其他网页来源不能写入本机问答')
  check((await ask('脚本成功了，为什么连接器还没验证？')).status === 409, '未绑定不得调用模型')
  const { id } = await insertQuestion(db, { ownerId: LOCAL_OWNER, eventId, projectId: 'p', text: '脚本成功了，为什么连接器还没验证？' })
  check((await chat())[0]?.answered === false, '旧版手动问题仍可读回')
  check((await listChat(db, { ownerId: 'other', eventId })).length === 0, '其他用户读不到事件问答')
  await assert.rejects(insertAnswer(db, { ownerId: 'other', questionId: id, text: '越权' }), { code: 'question_not_found' })
  check(true, '其他用户不能回答该问题')
  await local.connect(transport(file))
  const pending = await call(local, 'read_learning_questions', { event_id: eventId })
  check(pending.questions.length === 1 && pending.questions[0].id === id, '真实 MCP stdio 按事件读取网页提问')
  const args = { question_id: id, answer: '这条证据只覆盖脚本实际执行的路径。' }
  const replies = await Promise.all([call(local, 'answer_learning_question', args), call(local, 'answer_learning_question', args)])
  check(replies.map((r) => r.status).sort().join() === 'accepted,duplicate' && replies[0].answer_id === replies[1].answer_id, '两次同时回答只保存一条')
  check((await call(local, 'answer_learning_question', { ...args, answer: '不一样的回答' })).error === 'already_answered', '不同回答不能覆盖原回答')
  check((await call(local, 'answer_learning_question', { ...args, question_id: crypto.randomUUID() })).error === 'question_not_found', '不存在的问题不能答复')
  const thread = await chat()
  check(thread.length === 2 && thread[0].answered && thread[1].question_id === id && thread[1].text === args.answer, '网页按顺序读回同一问题及真实 MCP 写回的回答')
  check((await call(local, 'read_learning_questions', {})).questions.length === 0, '已回答的问题不再待答')
  await insertQuestion(db, { ownerId: LOCAL_OWNER, eventId, projectId: 'p', text: '那云端呢？' })
  const followup = await call(local, 'read_learning_questions', { project: 'p' })
  check(followup.questions[0].recent_messages[1].text === args.answer, '追问附同一事件的前文')
  await cloud.connect(transport(cloudFile, 'https://example.invalid'))
  check((await call(cloud, 'read_learning_questions')).error === 'chat_bridge_local_only', '云配置不读取本地问题')
  check((await call(cloud, 'answer_learning_question', args)).error === 'chat_bridge_local_only' && !existsSync(cloudFile), '云配置不写本地回答或创建本地文件')
  const calls: { question: string; history: { text: string }[]; record: { title: string } }[] = []
  let unblock: () => void = () => {}
  const barrier = new Promise<void>((done) => { unblock = done })
  const auto = createLocalServer({ db, port: 0, agents: { example: {
    name: 'test-agent',
    async listModels() { return [{ id: 'test-model', label: 'Test model' }] },
    async answer(context: typeof calls[number], model: string) {
      calls.push(context)
      if (context.question === '暂时失败' && calls.filter((c) => c.question === '暂时失败').length === 1) throw new Error('agent_timeout')
      if (context.question === '新问题') await barrier
      assert.equal(model, 'test-model')
      return { text: `答：${context.question}`, model: 'reported-test-model' }
    },
  } } })
  auto.listen(0, '127.0.0.1')
  try {
    await once(auto, 'listening')
    const autoAddr = auto.address()
    assert.ok(autoAddr && typeof autoAddr !== 'string')
    const origin = `http://127.0.0.1:${autoAddr.port}`
    const post = (route: string, body: Record<string, unknown>) => fetch(`${origin}/api/${route}`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ event_id: eventId, ...body }),
    })
    const waitFor = async (predicate: (t: { messages: any[]; agent: { busy: boolean } | null }) => boolean) => {
      for (let retry = 0; retry < 80; retry++) {
        const state = await (await fetch(`${origin}/api/chat?event_id=${eventId}`)).json()
        if (predicate(state)) return state
        await delay(25)
      }
      throw new Error('agent state did not settle')
    }
    check((await post('project-agent', { provider: 'codex', model: null })).status === 400, '拒绝未注册的 Agent，不作隐式回落')
    check((await post('project-agent', { provider: 'example', model: 'missing' })).status === 400, '拒绝模型目录没有的模型')
    check((await post('project-agent', { provider: 'example', model: 'test-model' })).status === 200, '项目绑定和模型写入持久化')
    const persisted = await waitFor((t) => Boolean(t.agent))
    check(persisted.agent.provider === 'example' && persisted.agent.model === 'test-model', '再次读取得到项目绑定')
    check((await post('ask', { question: '新问题' })).status === 202, '页面提交直接触发配置的 Agent')
    await waitFor((t) => t.agent?.busy === true && t.messages.some((m) => m.text === '新问题' && m.state === 'running'))
    check((await post('ask', { question: '不应入库' })).status === 409, '生成期间拒绝同机并发提交')
    unblock()
    await waitFor((t) => t.agent?.busy === false && t.messages.some((m) => m.text === '答：新问题' && m.source === 'test-agent'))
    check((await post('ask', { question: '那这一步呢？' })).status === 202, '同一事件继续追问')
    await waitFor((t) => t.agent?.busy === false && t.messages.some((m) => m.text === '答：那这一步呢？'))
    check(calls[1].record.title === '测试事件' && calls[1].history[calls[1].history.length - 1]?.text === '答：新问题'
      && !calls[1].history.some((m) => m.text === '那云端呢？'), '追问带同一记录及已完成的前文，不混入未答问题')
    const failed = await (await post('ask', { question: '暂时失败' })).json()
    await waitFor((t) => t.messages.some((m) => m.id === failed.question_id && m.state === 'failed' && m.error === 'agent_timeout'))
    check((await post('chat/retry', { event_id: crypto.randomUUID(), question_id: failed.question_id })).status === 404, '重试不能跨记录')
    check((await post('chat/retry', { question_id: failed.question_id })).status === 202, '失败后可重试原问题')
    const retried = await waitFor((t) => t.agent?.busy === false && t.messages.some((m) => m.question_id === failed.question_id))
    check(retried.messages.filter((m: { text: string }) => m.text === '暂时失败').length === 1, '重试不复制用户问题')
  } finally {
    unblock()
    await new Promise<void>((done) => auto.close(() => done()))
  }
  console.log(`\n${checks} PASS`)
} finally {
  await Promise.all([local.close(), cloud.close()])
  if (server.listening) await new Promise<void>((done) => server.close(() => done()))
  rmSync(temp, { recursive: true, force: true })
}
