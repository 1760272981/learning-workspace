import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-store',
      configureServer(server) {
        server.middlewares.use('/api/store', (_req, res) => {
          const storePath = path.resolve(import.meta.dirname, 'mcp/data/store.json')
          res.setHeader('Content-Type', 'application/json')
          try {
            res.end(fs.readFileSync(storePath, 'utf8'))
          } catch {
            res.end(JSON.stringify({ projects: {} }))
          }
        })
      },
    },
  ],
  build: {
    outDir: 'dist',
  },
})