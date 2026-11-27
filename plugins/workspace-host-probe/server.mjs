import http from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

const port = 8791
const uri = 'ui://workspace-host-probe/index.html'
const mimeType = 'text/html;profile=mcp-app'
const script = await readFile(new URL('./app.js', import.meta.url), 'utf8')
const appHtml = (await readFile(new URL('./app.html', import.meta.url), 'utf8')).replace('/* APP_SCRIPT */', () => script)
const appOnly = { ui: { visibility: ['app'] } }
const modelOnly = { ui: { visibility: ['model'] } }
const sessions = new Map()
const runs = new Map()
const secret = () => randomBytes(24).toString('hex')
const success = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value })
const failure = (text) => ({ isError: true, content: [{ type: 'text', text }] })

function prune() {
  const now = Date.now()
  for (const [id, run] of runs) if (run.expires <= now) runs.delete(id)
  for (const [id, item] of sessions) if (item.expires <= now) sessions.delete(id)
}

function makeServer() {
  const server = new McpServer({ name: 'workspace-host-probe', version: '0.1.0' })
  server.registerResource('workspace-host-probe-ui', uri, { mimeType }, async () => ({ contents: [{ uri, mimeType, text: appHtml,
    _meta: { 'qoder/ui': { availableDisplayModes: ['fullscreen'], preferredDisplayMode: 'fullscreen' } },
  }] }))
  server.registerTool('open_workspace_probe', {
    title: 'Learning Workspace 桌面联调', description: '打开不含项目数据的 Qoder 宿主联调页面。', inputSchema: {},
    annotations: { readOnlyHint: true }, _meta: { ui: { visibility: ['app'], resourceUri: uri }, 'qoder/ui': { entrypoints: [{ type: 'global' }] } },
  }, async () => success({ ready: true }))
  server.registerTool('prepare_workspace_probe', {
    description: '用户主动发问时创建无项目数据的短期对账位。', _meta: appOnly,
    inputSchema: { conversation: z.string().uuid().optional() },
  }, async ({ conversation }) => {
    prune()
    if (sessions.size >= 64 || runs.size >= 128) return failure('短期探针过多，请稍后再试。')
    let chat = sessions.get(conversation)
    if (conversation && (!chat || chat.step !== 1 || !chat.session)) return failure('没有已完成的首问，不能续问。')
    if (!chat) {
      conversation = randomUUID()
      chat = { marker: `ORCHID-${randomBytes(4).toString('hex')}`, expires: Date.now() + 900000, step: 0 }
      sessions.set(conversation, chat)
    }
    const id = randomUUID()
    const writeKey = secret()
    runs.set(id, { conversation, writeKey, expires: chat.expires })
    const question = chat.step === 0 ? `请记住随机词 ${chat.marker}，并简短说你记住了什么。` : '刚才那一轮我让你记住的随机词是什么？'
    const prompt = `${question}\n这是用户主动发起的桌面连通性测试，不读取文件或项目。请调用当前会话可用的 MCP 工具 return_workspace_probe，把你给页面的实际回答作为 answer 参数写回（id=${id}，write_key=${writeKey}）。不要调用其他工具，不要把写入凭据放在答复正文。`
    return success({ id, conversation, question, prompt })
  })
  server.registerTool('read_workspace_probe', {
    description: '读取本页面的一次探针写回。', _meta: appOnly,
    inputSchema: { id: z.string().uuid() },
  }, async ({ id }) => {
    prune()
    const run = runs.get(id)
    return run ? success({ reply: run.reply ?? null, session: run.session ?? null }) : failure('此轮对账位已失效。')
  })
  server.registerTool('return_workspace_probe', {
    description: '只在当前合成测试请求明确给出 id 和一次性 write_key 时，把本轮真实回答写回 Learning Workspace 探针。', _meta: modelOnly,
    inputSchema: { id: z.string().uuid(), write_key: z.string().regex(/^[\da-f]{48}$/), answer: z.string().trim().min(1).max(800) },
  }, async ({ id, write_key, answer }, extra) => {
    prune()
    const run = runs.get(id)
    if (!run || run.writeKey !== write_key) return failure('写入凭据无效。')
    const session = extra._meta?.['com.qoder/turnContext']?.sessionId
    if (typeof session !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(session)) return failure('该调用没有 Qoder 会话上下文，不能验证续问。')
    const chat = sessions.get(run.conversation)
    if (!chat || (chat.session && chat.session !== session)) return failure('此次回传不属于首问所在会话。')
    if (run.reply) return run.reply === answer ? success({ accepted: true }) : failure('同一轮不能覆写。')
    if (!answer.toLowerCase().includes(chat.marker.toLowerCase())) return failure('回答缺少用户指定的随机词。')
    if (answer.includes(write_key)) return failure('答复正文不能携带写入凭据。')
    chat.session = session
    chat.step += 1
    run.session = session
    run.reply = answer
    console.log(`Qoder 探针收到回传：轮次=${chat.step} 会话=${session}`)
    return success({ accepted: true })
  })
  return server
}

const listener = http.createServer(async (req, res) => {
  if (req.headers.host !== `127.0.0.1:${port}` || req.headers.origin || req.url !== '/mcp') { res.writeHead(403).end(); return }
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  const mcp = makeServer()
  res.once('close', () => void mcp.close().catch(() => {}))
  try {
    await mcp.connect(transport)
    await transport.handleRequest(req, res)
  } catch {
    if (!res.headersSent) res.writeHead(500).end()
    else res.end()
  }
})
listener.listen(port, '127.0.0.1', () => console.log(`Qoder 探针本地 MCP 已就绪：127.0.0.1:${port}`))
