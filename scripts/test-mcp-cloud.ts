import assert from 'node:assert/strict'
import { submitToCloud } from '../mcp/cloud.ts'
import type { SubmitInput } from '../shared/model.ts'

const input: SubmitInput = { project: 'p', output_ref: 'v1', title: '测试候选' }
const config = { apiBase: 'https://example.invalid/functions/v1/app', userToken: crypto.randomUUID(), timeoutMs: 50 }
let passed = 0
function check(label: string, run: () => Promise<void>) {
  return run().then(() => {
    passed++
    console.log(`PASS ${label}`)
  })
}

await check('云提交显式带 Origin、Bearer 个人令牌和 action=submit', async () => {
  let calls = 0
  const result = await submitToCloud(input, {
    ...config,
    fetchImpl: async (url, init) => {
      calls++
      assert.equal(new URL(url.toString()).searchParams.get('action'), 'submit')
      const headers = new Headers(init?.headers)
      assert.equal(headers.get('Origin'), 'https://example.invalid')
      assert.equal(headers.get('Authorization'), `Bearer ${config.userToken}`)
      assert.equal(headers.get('x-lw-write-key'), null)
      assert.equal(init?.method, 'POST')
      return Response.json({ status: 'accepted', node_id: 'node', hints: [] })
    },
  })
  assert.equal(calls, 1)
  assert.equal(result.status, 'accepted')
})

await check('断网或超时返回 pending 且不自动重发', async () => {
  let calls = 0
  const result = await submitToCloud(input, {
    ...config,
    fetchImpl: async () => {
      calls++
      throw new DOMException('The operation was aborted', 'TimeoutError')
    },
  })
  assert.equal(calls, 1)
  assert.equal(result.status, 'pending')
  assert.equal((result as { pending?: boolean }).pending, true)
  assert.match(JSON.stringify(result), /不要自动重发/)
})

await check('网关 5xx 视为结果未知', async () => {
  const result = await submitToCloud(input, { ...config, fetchImpl: async () => Response.json({ error: 'gateway' }, { status: 503 }) })
  assert.equal(result.status, 'pending')
})

await check('明确 403 返回失败且不泄露令牌', async () => {
  const result = await submitToCloud(input, { ...config, fetchImpl: async () => Response.json({ error: 'forbidden' }, { status: 403 }) })
  assert.equal(result.status, 'failed')
  assert.equal((result as { error?: string }).error, 'forbidden')
  assert.ok(!JSON.stringify(result).includes(config.userToken))
})

await check('非法 API_BASE 不发出请求', async () => {
  let calls = 0
  const result = await submitToCloud(input, {
    ...config,
    apiBase: 'file:///tmp/not-an-api',
    fetchImpl: async () => {
      calls++
      return Response.json({ status: 'accepted', hints: [] })
    },
  })
  assert.equal(calls, 0)
  assert.equal(result.status, 'failed')
  assert.equal((result as { error?: string }).error, 'invalid_lw_api_base')
})

await check('密钥模式显式带 x-lw-write-key 且不带 Authorization', async () => {
  const writeKey = crypto.randomUUID()
  const result = await submitToCloud(input, {
    apiBase: config.apiBase,
    writeKey,
    timeoutMs: 50,
    fetchImpl: async (_url, init) => {
      const headers = new Headers(init?.headers)
      assert.equal(headers.get('x-lw-write-key'), writeKey)
      assert.equal(headers.get('Authorization'), null)
      assert.equal(headers.get('Origin'), 'https://example.invalid')
      return Response.json({ status: 'accepted', node_id: 'node', hints: [] })
    },
  })
  assert.equal(result.status, 'accepted')
})

await check('令牌与密钥都配置时个人令牌优先', async () => {
  const result = await submitToCloud(input, {
    ...config,
    writeKey: 'legacy-key-value',
    fetchImpl: async (_url, init) => {
      const headers = new Headers(init?.headers)
      assert.equal(headers.get('Authorization'), `Bearer ${config.userToken}`)
      assert.equal(headers.get('x-lw-write-key'), null)
      return Response.json({ status: 'accepted', node_id: 'node', hints: [] })
    },
  })
  assert.equal(result.status, 'accepted')
})

console.log(`\nMCP CLOUD ${passed} PASS`)
