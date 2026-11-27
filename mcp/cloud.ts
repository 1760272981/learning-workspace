import type { ProjectEvent, ProjectUpdateInput, ProjectUpdateResult, SubmitInput, SubmitResult } from '../shared/model.ts'

export interface PendingSubmit {
  status: 'pending'
  pending: true
  error: 'write_result_unknown'
  hints: string[]
}

export interface FailedSubmit {
  status: 'failed'
  error: string
  http_status: number
  hints: string[]
}

export type CloudSubmitReply = SubmitResult | PendingSubmit | FailedSubmit
export type CloudUpdateReply = ProjectUpdateResult | PendingSubmit | FailedSubmit
export type CloudReadReply = { status: 'ok', events: ProjectEvent[] } | PendingSubmit | FailedSubmit

const UNKNOWN_HINTS = [
  '请求可能已经到达云端，不要自动重发。',
  '稍后读取云端数据，按原 project + output_ref + 规范标题对账；需要时再用原幂等键提交。',
]

const UPDATE_UNKNOWN_HINTS = [
  '请求可能已经到达云端，不要自动重发。',
  '先用 read_project_updates 按原 project + task_id + run_id 查回事件；查不到再决定是否用原身份重提。',
]

export interface CloudConfig {
  apiBase: string
  userToken?: string
  writeKey?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

function endpoint(base: string, action: string): URL {
  const url = new URL(base)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('invalid_lw_api_base')
  }
  url.searchParams.set('action', action)
  return url
}

function authHeaders(config: CloudConfig, origin: string): Record<string, string> {
  return {
    Accept: 'application/json',
    Origin: origin,
    // 双契约：沙箱用个人令牌 Bearer；旧站 legacy 用共享写密钥头。两者都配时令牌优先。
    ...(config.userToken
      ? { Authorization: `Bearer ${config.userToken}` }
      : { 'x-lw-write-key': config.writeKey || '' }),
  }
}

async function safeError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown }
    if (typeof body.error === 'string' && /^[a-z0-9_]+$/.test(body.error)) return body.error
  } catch {
    // 不记录或回传网关、供应商的原始错误。
  }
  return 'cloud_write_rejected'
}

async function postToCloud(
  body: unknown,
  config: CloudConfig,
  action: string,
  validStatuses: string[],
  unknownHints: string[],
): Promise<{ status: string } | PendingSubmit | FailedSubmit> {
  let url: URL
  try {
    url = endpoint(config.apiBase, action)
  } catch {
    return { status: 'failed', error: 'invalid_lw_api_base', http_status: 0, hints: ['请检查 LW_API_BASE 配置。'] }
  }

  let response: Response
  try {
    response = await (config.fetchImpl || fetch)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(config, url.origin) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs || 12000),
      redirect: 'error',
    })
  } catch {
    return { status: 'pending', pending: true, error: 'write_result_unknown', hints: unknownHints }
  }

  if (response.status >= 500) return { status: 'pending', pending: true, error: 'write_result_unknown', hints: unknownHints }
  if (!response.ok) {
    return {
      status: 'failed',
      error: await safeError(response),
      http_status: response.status,
      hints: ['云端明确拒绝了本次请求；修正配置或内容后再决定是否提交。'],
    }
  }

  try {
    const parsed = await response.json() as { status?: unknown }
    if (!parsed || typeof parsed.status !== 'string' || !validStatuses.includes(parsed.status)) throw new Error('invalid_response')
    return parsed as { status: string }
  } catch {
    return { status: 'pending', pending: true, error: 'write_result_unknown', hints: unknownHints }
  }
}

export async function submitToCloud(input: SubmitInput, config: CloudConfig): Promise<CloudSubmitReply> {
  return await postToCloud(input, config, 'submit', ['accepted', 'linked', 'missing_evidence', 'over_limit'], UNKNOWN_HINTS) as CloudSubmitReply
}

export async function submitUpdateToCloud(input: ProjectUpdateInput, config: CloudConfig): Promise<CloudUpdateReply> {
  return await postToCloud(input, config, 'update', ['accepted', 'duplicate', 'conflict', 'invalid'], UPDATE_UNKNOWN_HINTS) as CloudUpdateReply
}

// 回执丢失后的对账读取：按原提交身份查回事件，只读不写
export async function readUpdatesFromCloud(
  params: { project?: string; task_id?: string; run_id?: string; event_id?: string },
  config: CloudConfig,
): Promise<CloudReadReply> {
  let url: URL
  try {
    url = endpoint(config.apiBase, 'updates')
  } catch {
    return { status: 'failed', error: 'invalid_lw_api_base', http_status: 0, hints: ['请检查 LW_API_BASE 配置。'] }
  }
  for (const [key, value] of Object.entries(params)) {
    if (value && value.trim()) url.searchParams.set(key, value.trim())
  }

  let response: Response
  try {
    response = await (config.fetchImpl || fetch)(url, {
      method: 'GET',
      headers: authHeaders(config, url.origin),
      signal: AbortSignal.timeout(config.timeoutMs || 12000),
      redirect: 'error',
    })
  } catch {
    return { status: 'pending', pending: true, error: 'write_result_unknown', hints: ['读取结果未知，稍后重试读取；不要据此重发提交。'] }
  }
  if (response.status >= 500) return { status: 'pending', pending: true, error: 'write_result_unknown', hints: ['读取结果未知，稍后重试读取；不要据此重发提交。'] }
  if (!response.ok) {
    return { status: 'failed', error: await safeError(response), http_status: response.status, hints: ['云端明确拒绝了读取；检查配置与登录状态。'] }
  }
  try {
    const body = await response.json() as { events?: unknown }
    if (!body || !Array.isArray(body.events)) throw new Error('invalid_response')
    return { status: 'ok', events: body.events as ProjectEvent[] }
  } catch {
    return { status: 'pending', pending: true, error: 'write_result_unknown', hints: ['读取响应无法确认，稍后重试读取。'] }
  }
}