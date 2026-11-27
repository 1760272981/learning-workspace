const button = document.querySelector('#ask')
const status = document.querySelector('#status')
const history = document.querySelector('#history')
const pending = new Map()
let sequence = 0
let step = 0
let conversation
let closed = false
let ready = false
let busy = false
let checkPending
let poll
const send = (message) => window.parent.postMessage({ jsonrpc: '2.0', ...message }, '*')
const tell = (text) => { status.textContent = text }
function request(method, params, timeout = 9000) {
  const id = `workspace-${++sequence}`
  return new Promise((resolve, reject) => {
    if (closed) { reject(new Error('页面已关闭')); return }
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('宿主未确认')) }, timeout)
    pending.set(id, { timer, resolve, reject })
    send({ id, method, params })
  })
}
function receive(event) {
  if (event.source !== window.parent || event.data?.jsonrpc !== '2.0') return
  const { id, method, result, error } = event.data
  if (!method && pending.has(id)) {
    const task = pending.get(id)
    clearTimeout(task.timer)
    pending.delete(id)
    if (error) task.reject(new Error(String(error.message || '宿主拒绝请求').slice(0, 180)))
    else task.resolve(result)
  } else if (method === 'ping') send({ id, result: {} })
  else if (method === 'ui/resource-teardown') { send({ id, result: {} }); dispose() }
}
function dispose() {
  closed = true
  clearTimeout(poll)
  window.removeEventListener('message', receive)
  for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('页面已关闭')) }
  pending.clear()
}
async function tool(name, args = {}) {
  const result = await request('tools/call', { name, arguments: args })
  if (result?.isError || !result?.structuredContent) throw new Error(result?.content?.[0]?.text || '连通性测试工具没有返回结果')
  return result.structuredContent
}
function line(label, text, group) {
  const p = document.createElement('p')
  const name = document.createElement('strong')
  name.textContent = `${label}：`
  p.append(name, text)
  group.append(p)
}
async function observe(id, group, deadline) {
  if (closed) return
  let state
  try { state = await tool('read_workspace_probe', { id }) }
  catch { tell('暂未读到回传状态；页面将继续对账，不会重发。') }
  if (closed) return
  if (state?.reply) {
    line('Qoder 写回', state.reply, group)
    line('运行证据', `会话 ${state.session}; 模型 ${state.model || '宿主未在 MCP 回传中披露'}`, group)
    step += 1
    checkPending = undefined
    busy = false
    button.textContent = step === 1 ? '在同一会话追问' : '已完成两轮'
    button.disabled = step === 2
    tell(step === 1 ? '已收到首答，可在这里追问。' : '已收到两轮 MCP 写回；仍需与宿主运行记录核对模型。')
    return
  }
  if (Date.now() < deadline) poll = setTimeout(() => void observe(id, group, deadline), 1200)
  else {
    busy = false
    checkPending = () => observe(id, group, Date.now() + 30_000)
    button.textContent = '检查本轮回传'
    button.disabled = false
    tell('没有收到 MCP 回传。可以检查原问题的回传状态，不会再次投递。')
  }
}
async function ask() {
  if (!ready || busy || step >= 2) return
  busy = true
  button.disabled = true
  if (checkPending) {
    tell('正在检查本轮回传，不会再次投递…')
    await checkPending()
    return
  }
  let prepared
  try { prepared = await tool('prepare_workspace_probe', { ...(conversation ? { conversation } : {}) }) }
  catch (error) { tell(`尚未发给宿主：${error.message}`); busy = false; button.disabled = false; return }
  conversation = prepared.conversation
  const group = document.createElement('li')
  line('你', prepared.question, group)
  history.append(group)
  tell('等待宿主接收…')
  try {
    await request('ui/message', {
      role: 'user', content: [{ type: 'text', text: prepared.prompt }],
      _meta: { 'qoder/message': { target: 'active', send: true } },
    }, 120000)
    tell('宿主已接收，正在等 MCP 回传，不是答复完成。')
  } catch (error) {
    tell(`投递未确认：${error.message}。只检查回传，不自动重发。`)
  }
  void observe(prepared.id, group, Date.now() + 90_000)
}
window.addEventListener('message', receive)
window.addEventListener('pagehide', dispose, { once: true })
button.addEventListener('click', () => void ask())
if (window.parent === window) tell('请从 Qoder 左侧「更多」打开此插件页。')
else request('ui/initialize', {
  protocolVersion: '2026-01-26',
  appInfo: { name: 'workspace-host-probe', version: '0.1.0' },
  appCapabilities: { availableDisplayModes: ['fullscreen'] },
}).then((result) => {
  send({ method: 'ui/notifications/initialized', params: {} })
  ready = Boolean(result?.protocolVersion === '2026-01-26' && result?.hostCapabilities?.message && result?.hostCapabilities?.serverTools)
  button.disabled = !ready
  tell(ready ? '宿主已连接；只有点发送才会提交问题。' : '此视图未声明宿主投递或 MCP 工具能力，无法开始测试。')
}).catch((error) => tell(`无法初始化宿主：${error.message}`))
