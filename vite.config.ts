import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createApplication } from './functions/routes.mjs'
import { createFakeDb } from './scripts/fake-db.ts'

const DEV_ORIGIN = 'https://learning-workspace.local'
const localDb = createFakeDb()
const localApp = createApplication({ db: localDb, origin: DEV_ORIGIN })

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-auth-backend',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const url = new URL(req.url || '/', 'http://localhost')
          if (!url.pathname.startsWith('/functions/v1/app')) return next()
          try {
            const chunks: Buffer[] = []
            let size = 0
            for await (const chunk of req) {
              const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
              size += bytes.length
              if (size > 32 * 1024) {
                res.statusCode = 413
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ error: 'payload_too_large' }))
                return
              }
              chunks.push(bytes)
            }
            const headers = new Headers()
            for (const [name, value] of Object.entries(req.headers)) {
              if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
            }
            if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method || 'GET')) headers.set('Origin', DEV_ORIGIN)
            const request = new Request(`${DEV_ORIGIN}${url.pathname}${url.search}`, {
              method: req.method,
              headers,
              ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
            })
            const response = await localApp({ request, requestId: 'local-dev' })
            res.statusCode = response.status
            for (const [name, value] of response.headers) res.setHeader(name, value)
            res.end(Buffer.from(await response.arrayBuffer()))
          } catch {
            res.statusCode = 503
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'service_unavailable' }))
          }
        })
      },
    },
  ],
  build: {
    outDir: 'dist',
  },
})
