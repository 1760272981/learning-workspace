import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { handleLearningStore } from '../functions/handler.ts'
import { findEvent } from '../functions/database.ts'
import { createFileDb, DEFAULT_LOCAL_DATA_FILE, LOCAL_OWNER } from './file-db.mjs'
import { insertAnswer, insertQuestion, listChat, QUESTION_MAX_LENGTH } from './chat-store.mjs'
import { agentError, createQoderAgent, explanationContext } from './local-agent.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_PORT = 8787
const BUSINESS = new Set(['store', 'submit', 'mark', 'verify', 'delete', 'updates', 'update', 'accept'])
const AUTH_ONLY = new Set(['register', 'login', 'logout', 'tokens'])
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
  res.end(JSON.stringify(body))
}

async function readBodyJson(req, limit = 64 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('payload_too_large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

function sendFile(req, res, distDir, pathname) {
  const decoded = decodeURIComponent(pathname)
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '')
  let file = path.resolve(distDir, relative)
  if (file !== distDir && !file.startsWith(`${distDir}${path.sep}`)) return json(res, 404, { error: 'not_found' })
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    if (path.extname(relative)) return json(res, 404, { error: 'not_found' })
    file = path.join(distDir, 'index.html')
  }
  if (!fs.existsSync(file)) return json(res, 503, { error: 'build_missing' })
  res.writeHead(200, {
    'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
  })
  if (req.method === 'HEAD') return res.end()
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res)
}

export function createLocalServer({ db = createFileDb(), distDir = path.join(ROOT, 'dist'), port = DEFAULT_PORT, agents = { qoder: createQoderAgent() } } = {}) {
  let active = null
  const failures = new Map()
  const bindings = () => db.from('lw_project_bindings')
  const readBinding = async (projectId) => {
    const { data, error } = await bindings().select('*').eq('owner_id', LOCAL_OWNER).eq('project_id', projectId)
    if (error) throw new Error('database_request_failed')
    return data[0] ?? null
  }
  const lookup = (key) => typeof key === 'string' && Object.hasOwn(agents, key) ? agents[key] : null
  const answer = async (event, questionId, binding, agent) => {
    try {
      const thread = await listChat(db, { ownerId: LOCAL_OWNER, eventId: event.id })
      const index = thread.findIndex((m) => m.id === questionId)
      const question = thread[index]
      if (!question || question.answered) return
      const previous = thread.slice(0, index)
      const replies = new Map(previous.filter((m) => m.role === 'agent').map((m) => [m.question_id, m]))
      const history = previous.filter((m) => m.role === 'user' && replies.get(m.id)?.provider === binding.provider).slice(-3)
        .flatMap((m) => [m, replies.get(m.id)])
      const result = await agent.answer(explanationContext(event, history, question.text), binding.model)
      await insertAnswer(db, { ownerId: LOCAL_OWNER, questionId, text: result.text, source: agent.name,
        runtime: { provider: binding.provider, model: result.model, requested_model: binding.model, request_id: result.requestId } })
    } catch (error) {
      if (error.code !== 'already_answered') {
        const code = agentError(error)
        failures.set(questionId, code)
        if (failures.size > 100) failures.delete(failures.keys().next().value)
      }
    } finally {
      active = null
    }
  }
  let boundPort = port
  const trustedOrigins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`])
  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || ''
      if (![`localhost:${boundPort}`, `127.0.0.1:${boundPort}`].includes(host)) return json(res, 403, { error: 'origin_forbidden' })
      const url = new URL(req.url || '/', `http://127.0.0.1:${boundPort}`)
      const pathname = url.pathname.replace(/^\/functions\/v1\/app(?=\/|$)/, '') || '/'
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method || 'GET') && !trustedOrigins.has(req.headers.origin || '')) {
        return json(res, 403, { error: 'origin_forbidden' })
      }
      if (pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, mode: 'local' })
      if (pathname === '/api/me' && req.method === 'GET') return json(res, 200, { user: { id: LOCAL_OWNER, username: 'local' }, mode: 'local' })
      if (pathname === '/api/project-agent/models' && req.method === 'GET') {
        const event = await findEvent(db, LOCAL_OWNER, url.searchParams.get('event_id') || '')
        if (!event) return json(res, 404, { error: 'event_not_found' })
        const binding = await readBinding(event.project_id)
        const provider = lookup(binding?.provider)
        if (!provider) return json(res, 409, { error: 'agent_unbound' })
        try { return json(res, 200, { models: await provider.listModels({ live: url.searchParams.get('refresh') === '1' }) }) }
        catch (error) { return json(res, 503, { error: agentError(error) }) }
      }
      if (pathname === '/api/project-agent' && req.method === 'POST') {
        let body
        try { body = await readBodyJson(req) } catch { return json(res, 400, { error: 'invalid_input' }) }
        const provider = lookup(body?.provider)
        if (!provider || typeof body?.event_id !== 'string' || (body.model !== null && typeof body.model !== 'string')) return json(res, 400, { error: 'invalid_input' })
        const event = await findEvent(db, LOCAL_OWNER, body.event_id)
        if (!event) return json(res, 404, { error: 'event_not_found' })
        if (body.model) {
          try {
            if (!(await provider.listModels()).some((m) => m.id === body.model)) return json(res, 400, { error: 'agent_model_unavailable' })
          } catch (error) { return json(res, 503, { error: agentError(error) }) }
        }
        if (active?.projectId === event.project_id) return json(res, 409, { error: 'agent_busy' })
        const row = { owner_id: LOCAL_OWNER, project_id: event.project_id, provider: body.provider, model: body.model || null }
        const first = await bindings().insertIfAbsent(row, { onConflict: 'owner_id,project_id' }).select('*')
        if (first.error) throw new Error('database_request_failed')
        if (!first.data.length) {
          const next = await bindings().update(row).eq('owner_id', LOCAL_OWNER).eq('project_id', event.project_id).select('*')
          if (next.error || !next.data.length) throw new Error('database_request_failed')
        }
        return json(res, 200, { ok: true })
      }
      if ((pathname === '/api/ask' || pathname === '/api/chat/retry') && req.method === 'POST') {
        let body
        try { body = await readBodyJson(req) } catch (error) {
          return json(res, error?.message === 'payload_too_large' ? 413 : 400, { error: error?.message === 'payload_too_large' ? 'payload_too_large' : 'invalid_input' })
        }
        const eventId = typeof body?.event_id === 'string' ? body.event_id.trim() : ''
        const question = typeof body?.question === 'string' ? body.question.trim() : ''
        const retry = pathname === '/api/chat/retry'
        let questionId = typeof body?.question_id === 'string' ? body.question_id.trim() : ''
        if (!eventId || (retry && !questionId)) return json(res, 400, { error: 'invalid_input' })
        if (!retry && (!question || question.length > QUESTION_MAX_LENGTH)) return json(res, 400, { error: 'invalid_question' })
        const event = await findEvent(db, LOCAL_OWNER, eventId)
        if (!event) return json(res, 404, { error: 'event_not_found' })
        const binding = await readBinding(event.project_id)
        const agent = lookup(binding?.provider)
        if (!agent || !binding.model) return json(res, 409, { error: agent ? 'agent_model_unavailable' : 'agent_unbound' })
        if (retry) {
          const thread = await listChat(db, { ownerId: LOCAL_OWNER, eventId })
          const saved = thread.find((m) => m.role === 'user' && m.id === questionId)
          if (!saved || saved.provider !== binding.provider) return json(res, 404, { error: 'question_not_found' })
          if (saved.answered || active?.questionId === questionId) return json(res, 200, { ok: true, question_id: questionId })
        }
        if (active) return json(res, 409, { error: 'agent_busy' })
        active = { eventId, projectId: event.project_id, questionId: null }
        try {
          try {
            if (!(await agent.listModels()).some((m) => m.id === binding.model)) {
              active = null
              return json(res, 409, { error: 'agent_model_unavailable' })
            }
          } catch (error) {
            active = null
            return json(res, 503, { error: agentError(error) })
          }
          if (!retry) questionId = (await insertQuestion(db, { ownerId: LOCAL_OWNER, projectId: event.project_id, eventId, text: question, provider: binding.provider })).id
        } catch (error) {
          active = null
          throw error
        }
        failures.delete(questionId)
        active.questionId = questionId
        void answer(event, questionId, binding, agent)
        return json(res, 202, { ok: true, question_id: questionId })
      }
      if (pathname === '/api/chat' && req.method === 'GET') {
        const eventId = (url.searchParams.get('event_id') || '').trim()
        if (!eventId) return json(res, 400, { error: 'invalid_input' })
        const event = await findEvent(db, LOCAL_OWNER, eventId)
        if (!event) return json(res, 404, { error: 'event_not_found' })
        const current = active
        const [messages, binding] = await Promise.all([listChat(db, { ownerId: LOCAL_OWNER, eventId }), readBinding(event.project_id)])
        const agent = lookup(binding?.provider)
        return json(res, 200, {
          ok: true,
          providers: Object.entries(agents).map(([id, provider]) => ({ id, name: provider.name })),
          agent: binding ? { provider: binding.provider, name: agent?.name ?? binding.provider, model: binding.model, busy: Boolean(current || active) } : null,
          messages: messages.map((m) => m.role === 'user' && !m.answered ? {
            ...m,
            ...(current?.questionId === m.id || active?.questionId === m.id ? { state: 'running' }
              : failures.has(m.id) ? { state: 'failed', error: failures.get(m.id) } : { state: 'idle' }),
          } : m),
        })
      }
      if (AUTH_ONLY.has(pathname.match(/^\/api\/([^/]+)(?:\/|$)/)?.[1] || '')) return json(res, 404, { error: 'local_mode_only' })
      const action = pathname.match(/^\/api\/(store|submit|mark|verify|delete|updates|update|accept)$/)?.[1]
        || (pathname === '/' && BUSINESS.has(url.searchParams.get('action')) ? url.searchParams.get('action') : null)
      if (action && BUSINESS.has(action)) {
        const headers = new Headers()
        for (const [name, value] of Object.entries(req.headers)) {
          if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
        }
        const request = new Request(`${url.origin}${pathname}${url.search}`, {
          method: req.method,
          headers,
          ...(['GET', 'HEAD'].includes(req.method || 'GET') ? {} : { body: Readable.toWeb(req), duplex: 'half' }),
        })
        const response = await handleLearningStore({ request, db, ownerId: LOCAL_OWNER })
        res.writeHead(response.status, Object.fromEntries(response.headers))
        res.end(Buffer.from(await response.arrayBuffer()))
        return
      }
      if (pathname.startsWith('/api/')) return json(res, 404, { error: 'not_found' })
      if (!['GET', 'HEAD'].includes(req.method || 'GET')) return json(res, 405, { error: 'method_not_allowed' })
      sendFile(req, res, distDir, pathname)
    } catch {
      if (!res.headersSent) json(res, 503, { error: 'service_unavailable' })
      else res.destroy()
    }
  })
  server.on('listening', () => {
    const address = server.address()
    if (address && typeof address === 'object') {
      boundPort = address.port
      trustedOrigins.clear()
      trustedOrigins.add(`http://localhost:${boundPort}`)
      trustedOrigins.add(`http://127.0.0.1:${boundPort}`)
    }
  })
  server.localDataFile = process.env.LW_LOCAL_DATA_FILE || DEFAULT_LOCAL_DATA_FILE
  return server
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const configured = Number(process.env.LOCAL_PORT || DEFAULT_PORT)
  if (!Number.isInteger(configured) || configured < 1 || configured > 65535) throw new Error('invalid_local_port')
  const server = createLocalServer({ port: configured })
  server.listen(configured, '127.0.0.1', () => {
    console.log(`Learning Workspace 本地模式：http://localhost:${configured}`)
    console.log(`本地数据：${server.localDataFile}`)
  })
}
