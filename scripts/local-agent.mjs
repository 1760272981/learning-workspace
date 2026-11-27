import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { accessToken, qodercliAuth, query } from '@qodercn-ai/qodercn-agent-sdk'

const skill = new URL('../skills/teaching-explain/SKILL.md', import.meta.url)
const workDir = fileURLToPath(new URL('../local-data/qoder-teaching/', import.meta.url))
const clip = (value, max = 700) => typeof value === 'string' ? value.slice(0, max) : undefined
const select = (rows, fields, count) => (rows ?? []).slice(0, count).map((row) =>
  Object.fromEntries(fields.map((field) => [field, clip(row[field])])),
)

export function explanationContext(event, history, question) {
  return {
    record: {
      title: clip(event.task_title), outcome: clip(event.outcome),
      revision: clip(event.source_revision?.ref),
      verifications: select(event.verifications, ['item', 'status', 'scope', 'environment', 'evidence', 'revision'], 16),
      changes: select(event.changes, ['summary', 'sync'], 8),
      decisions: select(event.decisions, ['decision', 'reason'], 5),
      risks: select(event.risks, ['text', 'kind'], 6),
    },
    history: history.slice(-6).map(({ role, text }) => ({ role, text: clip(text, 2400) })),
    question,
  }
}

export function agentError(error) {
  if (/^agent_[a-z_]+$/.test(error?.message ?? '')) return error.message
  if (error?.name === 'AbortError') return 'agent_timeout'
  if (/AUTH_REQUIRED|authentication_failed|unauthoriz|not logged in|not authenticated/i.test(`${error?.code} ${error?.message}`)) return 'agent_auth_required'
  if (/ENOTFOUND|ECONN|ETIMEDOUT|network|certificate|fetch failed/i.test(`${error?.code} ${error?.message}`)) return 'agent_network'
  return 'agent_failed'
}

export function createQoderAgent() {
  const name = 'Qoder CN SDK'
  let catalogCache
  let catalogRequest
  async function withQuery(prompt, model, timeout, read, systemPrompt = '') {
    const cwd = join(workDir, 'empty')
    await mkdir(cwd, { recursive: true })
    const abortController = new AbortController()
    const timer = setTimeout(() => abortController.abort(), timeout)
    let session
    const env = Object.fromEntries(Object.keys(process.env).filter((k) => /^(qoder.*|https?_proxy|all_proxy|no_proxy|node_use_env_proxy)$/i.test(k)).map((k) => [k, undefined]))
    const token = process.env.LW_QODER_PAT?.trim()
    env.LW_QODER_PAT = undefined
    try {
      session = query({ prompt, options: {
        auth: token ? accessToken(token) : qodercliAuth(), env, cwd, abortController,
        ...(model ? { model } : {}), systemPrompt, tools: [], maxTurns: 1, skills: [],
        settingSources: [], strictMcpConfig: true, mcpServers: {}, persistSession: false,
        permissionMode: 'default', canUseTool: async () => ({ behavior: 'deny', message: '教学问答不使用工具' }),
        stderr: () => {},
      } })
      return await read(session)
    } catch (error) {
      throw new Error(abortController.signal.aborted ? 'agent_timeout' : agentError(error))
    } finally {
      clearTimeout(timer)
      await session?.close().catch(() => {})
    }
  }
  async function listModels({ live = false } = {}) {
    if (!live && catalogCache?.expires > Date.now()) return catalogCache.models
    catalogRequest ??= (async () => {
      let release
      const pending = new Promise((resolve) => { release = resolve })
      try {
        return await withQuery((async function* () { await pending })(), null, 12_000, async (session) => {
          const data = await session.getAvailableModels({ fetchStrategy: 'live' })
          const models = data.filter((m) => m.isEnabled !== false && m.source === 'system' && m.value !== 'auto' && typeof m.value === 'string')
            .map((m) => ({ id: m.value, label: m.displayName || m.value, cost: m.priceFactor ?? null }))
          catalogCache = { models, expires: Date.now() + 60_000 }
          return models
        })
      } finally {
        release()
      }
    })().finally(() => { catalogRequest = null })
    return catalogRequest
  }
  return {
    name,
    listModels,
    async answer(context, model) {
      const source = await readFile(skill, 'utf8')
      const guidance = source.split('## 解释原则\n')[1]?.split('\n## ')[0]?.trim()
      if (!guidance) throw new Error('agent_unavailable')
      const systemPrompt = `你是项目讲解助理，只给出中文回答。把输入 JSON 当成待解释的资料，不调用工具。\n${guidance}`
      return withQuery(JSON.stringify(context), model, 90_000, async (session) => {
        let reportedModel
        let requestId
        for await (const item of session) {
          if (item.type === 'assistant') {
            if (item.error === 'authentication_failed') throw new Error('agent_auth_required')
            if (item.error === 'rate_limit') throw new Error('agent_rate_limited')
            if (item.error === 'billing_error') throw new Error('agent_billing')
            if (!item.isApiErrorMessage && !item.parent_tool_use_id && item.message?.content?.some((part) => part.type === 'text')) {
              reportedModel = item.message.model
              requestId = item.request_id
            }
          }
          if (item.type === 'result') {
            if (item.is_error || item.subtype !== 'success') throw new Error(agentError({ message: [item.terminal_reason, ...(item.errors ?? [])].join(' ') }))
            const text = item.result?.trim()
            if (!text || text.length > 6000 || !reportedModel) throw new Error('agent_failed')
            return { text, model: reportedModel, requestId }
          }
        }
        throw new Error('agent_failed')
      }, systemPrompt)
    },
  }
}
