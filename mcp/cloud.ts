import type { SubmitInput, SubmitResult } from '../shared/model.ts'

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

const UNKNOWN_HINTS = [
  '请求可能已经到达云端，不要自动重发。',
  '稍后读取云端数据，按原 project + output_ref + 规范标题对账；需要时再用原幂等键提交。',
]

function endpoint(base: string): URL {
  const url = new URL(base)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('invalid_lw_api_base')
  }
  url.searchParams.set('action', 'submit')
  return url
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

export async function submitToCloud(
  input: SubmitInput,
  config: { apiBase: string; userToken?: string; writeKey?: string; timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<CloudSubmitReply> {
  let url: URL
  try {
    url = endpoint(config.apiBase)
  } catch {
    return { status: 'failed', error: 'invalid_lw_api_base', http_status: 0, hints: ['请检查 LW_API_BASE 配置。'] }
  }

  let response: Response
  try {
    response = await (config.fetchImpl || fetch)(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: url.origin,
        // 双契约：沙箱用个人令牌 Bearer；旧站 legacy 用共享写密钥头。两者都配时令牌优先。
        ...(config.userToken
          ? { Authorization: `Bearer ${config.userToken}` }
          : { 'x-lw-write-key': config.writeKey || '' }),
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(config.timeoutMs || 12000),
      redirect: 'error',
    })
  } catch {
    return { status: 'pending', pending: true, error: 'write_result_unknown', hints: UNKNOWN_HINTS }
  }

  if (response.status >= 500) return { status: 'pending', pending: true, error: 'write_result_unknown', hints: UNKNOWN_HINTS }
  if (!response.ok) {
    return {
      status: 'failed',
      error: await safeError(response),
      http_status: response.status,
      hints: ['云端明确拒绝了本次请求；修正配置或内容后再决定是否提交。'],
    }
  }

  try {
    const body = await response.json() as SubmitResult
    if (!body || !['accepted', 'linked', 'missing_evidence', 'over_limit'].includes(body.status)) throw new Error('invalid_response')
    return body
  } catch {
    return { status: 'pending', pending: true, error: 'write_result_unknown', hints: UNKNOWN_HINTS }
  }
}
