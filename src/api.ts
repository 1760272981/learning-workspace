import type { Store, SubmitResult, ProjectEvent, UserAcceptance } from './types'

const API_PATH = '/functions/v1/app/api'

export interface User {
  id: string
  username: string
}

export interface PersonalToken {
  id: string
  label: string
  created_at: string
  revoked_at: string | null
}

export class CloudError extends Error {
  constructor(public code: string, message: string, public status = 0) {
    super(message)
    this.name = 'CloudError'
  }
}

const MESSAGES: Record<string, string> = {
  invalid_username: '用户名需为 3–32 位，只能包含字母、数字和下划线。',
  invalid_password: '密码至少 8 个字符，且不超过 256 字节。',
  invalid_input: '请求格式不正确，请检查输入后重试。',
  username_taken: '该用户名已被注册，请换一个。',
  invalid_credentials: '用户名或密码不正确。',
  rate_limited: '尝试次数过于频繁，请稍后再试。',
  login_required: '请先登录后继续。',
  session_expired: '登录状态已失效，请重新登录。',
  token_revoked: '个人令牌无效或已吊销，请重新创建。',
  origin_forbidden: '请求来源校验未通过，已被拒绝。',
  payload_too_large: '请求内容过大，已被拒绝。',
  concept_not_found: '这条知识不存在，或不属于当前账号。',
  event_not_found: '这条项目更新不存在，或不属于当前账号。',
  invalid_question: '问题不能为空，且不超过 2000 字。',
  question_not_found: '这条提问不存在，请刷新后重试。',
  agent_busy: 'Agent 正在回答另一条问题，请等这一轮完成。',
  agent_unavailable: '本机 Agent 未配置或无法启动。',
  agent_unbound: '这个项目还没有绑定 Agent。',
  agent_model_unavailable: '请选择当前接入允许使用的模型。',
  agent_auth_required: 'Qoder 独立接入尚未认证。请先为 Qoder CN CLI 登录，再刷新模型列表；桌面登录不会自动传给此接入。',
  agent_network: 'Qoder 接入无法连接模型服务，请检查教学进程的网络。',
  agent_timeout: 'Qoder 接入没有在规定时间内返回。',
  agent_rate_limited: '模型服务限流，请稍后重试。',
  agent_billing: '当前 Qoder 账号额度不足或无法使用所选模型。',
  agent_failed: 'Qoder 接入未返回有效结果。',
  database_request_failed: '数据服务暂时不可用，请稍后对账。',
  service_unavailable: '服务暂时不可用，请稍后重试。',
}

function messageFor(code: string, status: number, write: boolean): string {
  if (status === 401 && code === 'invalid_credentials') return MESSAGES.invalid_credentials
  if (status === 401) return MESSAGES[code] || '请先登录后继续。'
  if (MESSAGES[code]) return MESSAGES[code]
  if (status >= 500 && write) return '服务没有返回确定结果，请先读取对账，不要直接重发'
  if (status >= 500) return '服务暂时不可用，请稍后重试'
  return '请求没有通过校验，请检查填写内容'
}

async function requestJson(url: string, init: RequestInit = {}, write = false): Promise<unknown> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  let response: Response
  try {
    response = await fetch(url, { ...init, headers, credentials: 'same-origin', cache: 'no-store' })
  } catch {
    throw new CloudError(write ? 'write_result_unknown' : 'network_error', write ? '写入结果未知，请先读取对账，不要直接重发' : '网络连接失败，请稍后重试')
  }
  if (response.redirected || !response.headers.get('content-type')?.includes('application/json')) {
    throw new CloudError(write ? 'write_result_unknown' : 'invalid_response', write ? '写入响应无法确认，请先读取对账，不要直接重发' : '服务返回了非预期的响应', response.status)
  }
  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new CloudError(write ? 'write_result_unknown' : 'invalid_response', write ? '写入响应无法确认，请先读取对账，不要直接重发' : '服务返回了无效数据', response.status)
  }
  if (!response.ok) {
    const body = data && typeof data === 'object' ? data as { error?: unknown } : null
    const code = typeof body?.error === 'string' && /^[a-z0-9_]+$/.test(body.error) ? body.error : 'request_failed'
    throw new CloudError(code, messageFor(code, response.status, write), response.status)
  }
  return data
}

function userFrom(value: unknown): User {
  const body = value as { user?: unknown }
  const user = body?.user as Partial<User> | undefined
  if (!user || typeof user.id !== 'string' || typeof user.username !== 'string') {
    throw new CloudError('invalid_response', '服务返回的登录状态格式不正确')
  }
  return { id: user.id, username: user.username }
}

export interface Session {
  user: User
  mode: 'local' | 'cloud'
}

export async function fetchSession(): Promise<Session | null> {
  try {
    const value = await requestJson(`${API_PATH}/me`) as { user?: unknown, mode?: unknown }
    const user = userFrom(value)
    return { user, mode: value.mode === 'local' ? 'local' : 'cloud' }
  } catch (error) {
    if (error instanceof CloudError && error.status === 401) return null
    throw error
  }
}

export async function login(username: string, password: string): Promise<User> {
  return userFrom(await requestJson(`${API_PATH}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }, true))
}

export async function register(username: string, password: string): Promise<User> {
  return userFrom(await requestJson(`${API_PATH}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }, true))
}

export async function logout(): Promise<void> {
  await requestJson(`${API_PATH}/logout`, { method: 'POST' }, true)
}

export async function fetchStore(): Promise<Store> {
  const data = await requestJson(`${API_PATH}/store`) as Store
  if (!data || typeof data !== 'object' || !data.projects || typeof data.projects !== 'object') {
    throw new CloudError('invalid_store', '云端返回的数据格式不正确')
  }
  return data
}

export async function writeAction(action: 'submit' | 'mark' | 'verify' | 'delete', body: unknown): Promise<SubmitResult | { ok: true }> {
  const result = await requestJson(`${API_PATH}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  }, true) as SubmitResult | { ok: true }
  if (!result || typeof result !== 'object') throw new CloudError('write_result_unknown', '写入响应无法确认，请先读取对账，不要直接重发')
  if (action === 'submit' && !['accepted', 'linked', 'missing_evidence', 'over_limit'].includes((result as SubmitResult).status)) {
    throw new CloudError('write_result_unknown', '写入响应无法确认，请先读取对账，不要直接重发')
  }
  if (action !== 'submit' && (result as { ok?: unknown }).ok !== true) {
    throw new CloudError('write_result_unknown', '写入响应无法确认，请先读取对账，不要直接重发')
  }
  return result
}

export async function fetchTokens(): Promise<PersonalToken[]> {
  const data = await requestJson(`${API_PATH}/tokens`) as { tokens?: unknown }
  if (!Array.isArray(data?.tokens) || data.tokens.some((token) => {
    const row = token as Partial<PersonalToken> | null
    return !row || typeof row.id !== 'string' || typeof row.label !== 'string' || typeof row.created_at !== 'string' || !(row.revoked_at === null || typeof row.revoked_at === 'string')
  })) throw new CloudError('invalid_response', '令牌列表格式不正确')
  return data.tokens as PersonalToken[]
}

export async function createPersonalToken(label: string): Promise<{ token: string; label: string; created_at: string }> {
  const data = await requestJson(`${API_PATH}/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  }, true) as { token?: unknown; label?: unknown; created_at?: unknown }
  if (!data || typeof data !== 'object') throw new CloudError('write_result_unknown', '令牌创建结果无法确认，请先刷新列表核对')
  const created = data as { token?: unknown; label?: unknown; created_at?: unknown }
  if (typeof created.token !== 'string' || typeof created.label !== 'string' || typeof created.created_at !== 'string') {
    throw new CloudError('write_result_unknown', '令牌创建结果无法确认，请先刷新列表核对')
  }
  return { token: created.token, label: created.label, created_at: created.created_at }
}

export async function revokePersonalToken(id: string): Promise<void> {
  await requestJson(`${API_PATH}/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }, true)
}

export async function fetchUpdates(): Promise<ProjectEvent[]> {
  const data = await requestJson(`${API_PATH}/updates`) as { events?: unknown }
  if (!data || !Array.isArray(data.events)) {
    throw new CloudError('invalid_response', '项目更新数据格式不正确')
  }
  return data.events as ProjectEvent[]
}

export async function acceptUpdate(project: string, eventId: string, decision: 'accepted' | 'rejected', note?: string): Promise<UserAcceptance> {
  const result = await requestJson(`${API_PATH}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, event_id: eventId, decision, ...(note?.trim() ? { note: note.trim() } : {}) }),
    signal: AbortSignal.timeout(15000),
  }, true) as { ok?: unknown, acceptance?: UserAcceptance }
  if (result?.ok !== true || !result.acceptance || (result.acceptance.status !== 'accepted' && result.acceptance.status !== 'rejected')) {
    throw new CloudError('write_result_unknown', '验收写入结果无法确认，请刷新核对，不要直接重复写入')
  }
  return result.acceptance
}

// ---- 页面问答桥（仅本地链路） ----

export interface ChatMessage {
  id: string
  role: 'user' | 'agent'
  question_id: string | null
  text: string
  created_at: string
  answered?: boolean
  source?: string
  provider?: string
  model?: string
  requested_model?: string
  state?: 'running' | 'failed' | 'idle'
  error?: string
}

export interface AgentModel { id: string; label: string; cost: number | null }
export interface ChatThread {
  messages: ChatMessage[]
  providers: { id: string; name: string }[]
  agent: { provider: string; name: string; model: string | null; busy: boolean } | null
}

export async function fetchAgentModels(eventId: string, live = false): Promise<AgentModel[]> {
  const result = await requestJson(`${API_PATH}/project-agent/models?event_id=${encodeURIComponent(eventId)}${live ? '&refresh=1' : ''}`,
    { signal: AbortSignal.timeout(16000) }) as { models: AgentModel[] }
  return result.models
}

export async function bindProjectAgent(eventId: string, provider: string, model: string | null) {
  await requestJson(`${API_PATH}/project-agent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_id: eventId, provider, model }), signal: AbortSignal.timeout(16000),
  }, true)
}

export async function retryQuestion(eventId: string, questionId: string): Promise<void> {
  await requestJson(`${API_PATH}/chat/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_id: eventId, question_id: questionId }),
    signal: AbortSignal.timeout(15000),
  }, true)
}

export async function askQuestion(eventId: string, question: string): Promise<string> {
  const result = await requestJson(`${API_PATH}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_id: eventId, question }),
    signal: AbortSignal.timeout(15000),
  }, true) as { ok?: unknown, question_id?: unknown }
  if (result?.ok !== true || typeof result.question_id !== 'string' || !result.question_id) {
    throw new CloudError('write_result_unknown', '提问写入结果无法确认，请先刷新问答记录核对，不要直接重发')
  }
  return result.question_id
}

export async function fetchChat(eventId: string): Promise<ChatThread> {
  const data = await requestJson(`${API_PATH}/chat?event_id=${encodeURIComponent(eventId)}`, { signal: AbortSignal.timeout(4000) }) as { ok?: unknown, messages?: unknown, agent?: ChatThread['agent'], providers?: ChatThread['providers'] }
  if (data?.ok !== true || (data.agent !== null && (typeof data.agent?.name !== 'string' || typeof data.agent.busy !== 'boolean')) || !Array.isArray(data.messages) || data.messages.some((m) => {
    const row = m as Partial<ChatMessage> | null
    return !row || typeof row.id !== 'string' || (row.role !== 'user' && row.role !== 'agent')
      || typeof row.text !== 'string' || typeof row.created_at !== 'string'
      || !(row.question_id === null || typeof row.question_id === 'string')
  })) {
    throw new CloudError('invalid_response', '问答记录格式不正确，请稍后刷新重试')
  }
  return { messages: data.messages as ChatMessage[], agent: data.agent ?? null, providers: data.providers ?? [] }
}
