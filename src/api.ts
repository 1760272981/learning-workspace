import type { Store, SubmitResult } from './types'

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
