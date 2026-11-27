import { useState, useEffect, useRef, useCallback } from 'react'
import { CloudError, askQuestion, bindProjectAgent, fetchAgentModels, fetchChat, retryQuestion, type AgentModel, type ChatThread } from '../api'

const failures: Record<string, string> = {
  agent_unavailable: '本机 Agent 无法启动，请检查配置。',
  agent_timeout: 'Agent 没有在规定时间内返回。',
  agent_auth_required: 'Qoder 独立接入尚未认证，请完成登录后重试。',
  agent_network: 'Qoder 无法连接模型服务。',
  agent_rate_limited: '模型服务限流，请稍后重试。',
  agent_billing: '该账号的额度不足或无法使用所选模型。',
  agent_failed: 'Agent 未返回有效答复，请检查登录和网络后重试。',
}

export function EventChat({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).get('ask') === '1')
  const [thread, setThread] = useState<ChatThread | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [models, setModels] = useState<AgentModel[] | null>(null)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [configuring, setConfiguring] = useState(false)
  const seqRef = useRef(0)
  const logRef = useRef<HTMLOListElement>(null)
  const messageCount = thread?.messages.length ?? 0
  useEffect(() => {
    if (open && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [messageCount, open])

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current
    try {
      const result = await fetchChat(eventId)
      if (seq !== seqRef.current) return
      setThread(result)
      setReadError(null)
    } catch (cause) {
      if (seq === seqRef.current) setReadError(cause instanceof CloudError ? cause.message : '读取问答失败')
    }
  }, [eventId])

  const busy = thread?.agent?.busy ?? false
  useEffect(() => {
    if (open) void refresh()
    return () => { seqRef.current += 1 }
  }, [open, refresh])

  useEffect(() => {
    if (!open || !busy) return
    const timer = setInterval(() => { void refresh() }, 2400)
    return () => clearInterval(timer)
  }, [open, busy, refresh])

  const provider = thread?.agent?.provider
  const selectedModel = thread?.agent?.model
  const loadModels = useCallback(async (live = false) => {
    setConnectionError(null)
    try { setModels(await fetchAgentModels(eventId, live)) }
    catch (error) {
      setModels([])
      setConnectionError(error instanceof Error ? error.message : '读取模型失败')
    }
  }, [eventId])
  useEffect(() => {
    if (open && provider) void loadModels()
  }, [open, provider, loadModels])
  const saveBinding = async (key: string, model: string | null) => {
    setConfiguring(true)
    setSendError(null)
    try { await bindProjectAgent(eventId, key, model); await refresh() }
    catch (error) { setSendError(error instanceof Error ? error.message : '保存绑定失败') }
    finally { setConfiguring(false) }
  }
  const canSend = Boolean(selectedModel && models?.some((model) => model.id === selectedModel)) && !busy && !sending && !configuring
  const send = async (questionId?: string) => {
    const text = draft.trim()
    if (!canSend || (!questionId && !text)) return
    setSending(true)
    setSendError(null)
    try {
      if (questionId) await retryQuestion(eventId, questionId)
      else {
        await askQuestion(eventId, text)
        setDraft('')
      }
    } catch (cause) {
      setSendError(cause instanceof CloudError ? cause.message : '无法确认发送结果，请查看问答记录。')
    } finally {
      await refresh()
      setSending(false)
    }
  }

  const messages = thread?.messages ?? []
  const questions = messages.filter((m) => m.role === 'user')
  const answers = new Map(messages.filter((m) => m.role === 'agent').map((m) => [m.question_id, m]))
  const isFollowup = answers.size > 0

  return (
    <section className="mt-3 rounded-xl border border-leaf-200 bg-white/80" aria-label="项目问答">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-semibold text-leaf-800">
        <span>还有疑问？问你的本地 Agent</span>
        <span className="text-xs font-normal text-leaf-700">{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3">
          {thread ? (
            <div className="rounded-xl bg-leaf-50 px-3 py-2 text-xs leading-relaxed text-leaf-800">
              <strong>项目 Agent：{thread.agent?.name ?? '未绑定'}</strong>
              <p>MCP 提交：Workspace 已提供接口，此绑定的客户端实连尚未确认。</p>
              <p>页内问答：{provider && selectedModel && models?.some((m) => m.id === selectedModel) ? '已选模型，可发起提问' : provider ? '待认证并选择模型' : '请先绑定 Agent'}</p>
              {!provider && thread.providers.map((entry) => (
                <button key={entry.id} type="button" disabled={configuring} onClick={() => void saveBinding(entry.id, null)} className="mr-2 mt-1 underline">绑定 {entry.name}</button>
              ))}
              {thread.agent && (
                <>
                  <p>{provider === 'qoder' ? '使用独立 Qoder 会话，不跟随桌面模型；此接入不提供 HungerG。' : '使用此接入单独选择的模型。'}</p>
                  {selectedModel && <p>当前选定：{models?.find((m) => m.id === selectedModel)?.label ?? selectedModel}</p>}
                  {models && models.length > 0 && (
                    <label className="mr-2">教学模型 <select disabled={configuring || busy} value={models.some((m) => m.id === selectedModel) ? selectedModel ?? '' : ''}
                      onChange={(e) => { if (provider) void saveBinding(provider, e.target.value || null) }} className="rounded border bg-white px-1">
                      <option value="">请选择</option>
                      {models.map((m) => <option key={m.id} value={m.id}>{m.label}{m.cost === null ? '' : `（${m.cost}×）`}</option>)}
                    </select></label>
                  )}
                  <button type="button" disabled={configuring || busy} onClick={() => void loadModels(true)} className="underline">刷新接入模型列表</button>
                  {!models && !connectionError && <p role="status">正在查询接入支持的模型…</p>}
                  {connectionError && <p role="alert" className="text-red-700">{connectionError}</p>}
                  {models?.length === 0 && !connectionError && <p>当前账号没有可用的教学模型。</p>}
                  <p className="mt-1">发送会将问题、当前记录的证据摘要和同接入的近期问答交给在线模型；回复不是新增验证。</p>
                </>
              )}
            </div>
          ) : !readError ? <p className="text-xs text-leaf-700" role="status">正在读取问答…</p> : null}
          {(readError || sendError) && (
            <div role="alert" className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
              <span>{readError || sendError}</span>
              <button type="button" onClick={() => { setSendError(null); void refresh() }} className="shrink-0 underline">刷新记录</button>
            </div>
          )}
          {!questions.length && thread && <p className="mt-3 text-xs text-leaf-700/70">看不懂哪项验证，或不确定它能说明什么？可以从这里问。</p>}
          {questions.length > 0 && (
            <ol ref={logRef} className="mt-3 max-h-80 space-y-4 overflow-y-auto pr-1" aria-label="问答记录" aria-live="polite">
              {questions.map((question) => {
                const reply = answers.get(question.id)
                return (
                  <li key={question.id} className="space-y-1.5">
                    <div className="ml-auto max-w-[92%] rounded-xl border border-leaf-100 bg-leaf-50 px-3 py-2 text-sm">
                      <span className="block text-xs font-semibold text-leaf-700">你</span>
                      <p className="mt-0.5 whitespace-pre-wrap break-words">{question.text}</p>
                    </div>
                    {reply ? (
                      <div className="max-w-[96%] rounded-xl border border-leaf-100 bg-white px-3 py-2 text-sm leading-relaxed">
                        <span className="block text-xs font-semibold text-leaf-700">{reply.source || 'MCP 手动写回（来源未验证）'}{reply.model ? ` · ${reply.model}` : ''}</span>
                        {reply.requested_model && reply.requested_model !== reply.model && <p className="text-xs text-leaf-700">选择：{reply.requested_model}；上方为 SDK 实际返回的模型标识。</p>}
                        <p className="mt-0.5 whitespace-pre-wrap break-words">{reply.text}</p>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-leaf-700" role="status">
                        {question.state === 'running' ? '本机 Agent 正在回答…' : (
                          <>
                            <span>{question.state === 'failed' ? failures[question.error ?? ''] || failures.agent_failed : '问题已保存，尚未收到答复。'}</span>
                            {provider && question.provider === provider && <button type="button" onClick={() => void send(question.id)} disabled={!canSend} className="underline disabled:opacity-40">重试这条问题</button>}
                          </>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
          )}
          {thread?.agent && (
            <form className="mt-3" onSubmit={(e) => { e.preventDefault(); void send() }}>
              <label htmlFor="event-chat-input" className="text-xs font-semibold text-leaf-800">{isFollowup ? '接着问' : '你想弄明白什么？'}</label>
              <textarea id="event-chat-input" value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={2000} readOnly={sending}
                placeholder={isFollowup ? '可以直接接着上一轮问' : '例如：这条证据为什么只覆盖这一步？'}
                className="mt-1 block w-full rounded-xl border border-leaf-200 bg-white px-3 py-2 text-sm focus:border-leaf-500 focus:outline-none" />
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                <button type="button" onClick={(e) => {
                  const panel = e.currentTarget.closest('section')
                  setOpen(false)
                  panel?.querySelector('button')?.focus({ preventScroll: true })
                  panel?.scrollIntoView({ block: 'end' })
                }} className="text-xs text-leaf-700 underline underline-offset-2">收起问答，回看证据</button>
                <button type="submit" disabled={!canSend || !draft.trim()}
                  className="rounded-full bg-leaf-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-leaf-700 disabled:opacity-40">
                  {sending ? '正在发送…' : busy ? 'Agent 回答中…' : isFollowup ? '发送追问' : '发送提问'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  )
}
