import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { handleLearningStore } from '../functions/handler.ts'
import { createFileDb, DEFAULT_LOCAL_DATA_FILE, LOCAL_OWNER } from './file-db.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_PORT = 8787
const BUSINESS = new Set(['store', 'submit', 'mark', 'verify', 'delete'])
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

export function createLocalServer({ db = createFileDb(), distDir = path.join(ROOT, 'dist'), port = DEFAULT_PORT } = {}) {
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
      if (AUTH_ONLY.has(pathname.match(/^\/api\/([^/]+)(?:\/|$)/)?.[1] || '')) return json(res, 404, { error: 'local_mode_only' })
      const action = pathname.match(/^\/api\/(store|submit|mark|verify|delete)$/)?.[1]
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
