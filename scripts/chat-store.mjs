// 页面问答桥（仅本地）：lw_chat 行结构与读写规则的单一来源。
// 纯 JS，供 scripts/local-server.mjs 与 mcp/local.ts 共用；类型声明见 chat-store.d.mts。
// 行结构：{id, owner_id, project_id, event_id, role:'user'|'agent', question_id, text, created_at}
//   - 用户行 question_id=null；agent 行 question_id 指向用户行 id。
//   - 一条用户问题最多一条 agent 回答；重复同文回答返回 duplicate，不产生新行。

export const QUESTION_MAX_LENGTH = 2000

export class ChatBusinessError extends Error {
  constructor(code) {
    super(code)
    this.name = 'ChatBusinessError'
    this.code = code
  }
}

function nonEmpty(v) {
  return typeof v === 'string' && v.trim() !== ''
}

async function readRows(db, filters) {
  let builder = db.from('lw_chat').select('*')
  for (const [key, value] of filters) builder = builder.eq(key, value)
  const { data, error } = await builder
  if (error || !Array.isArray(data)) throw new Error('database_request_failed')
  return data
}

export async function insertQuestion(db, { ownerId, projectId, eventId, text, provider }) {
  if (!nonEmpty(ownerId) || !nonEmpty(projectId) || !nonEmpty(eventId)) throw new ChatBusinessError('invalid_input')
  if (!nonEmpty(text) || text.trim().length > QUESTION_MAX_LENGTH) throw new ChatBusinessError('invalid_question')
  const row = {
    id: crypto.randomUUID(),
    owner_id: ownerId,
    project_id: projectId,
    event_id: eventId,
    role: 'user',
    question_id: null,
    ...(provider ? { provider } : {}),
    text: text.trim(),
    created_at: new Date().toISOString(),
  }
  const { data, error } = await db.from('lw_chat').insertIfAbsent(row, { onConflict: 'id' }).select('id')
  if (error || !Array.isArray(data) || data.length !== 1) throw new Error('database_request_failed')
  return row
}

export async function insertAnswer(db, { ownerId, questionId, text, source, runtime }) {
  if (!nonEmpty(ownerId) || !nonEmpty(questionId)) throw new ChatBusinessError('invalid_input')
  if (!nonEmpty(text) || text.trim().length > 6000) throw new ChatBusinessError('invalid_answer')
  const matches = [['question_id', questionId], ['owner_id', ownerId], ['role', 'agent']]
  const questions = await readRows(db, [['id', questionId], ['owner_id', ownerId], ['role', 'user']])
  if (questions.length !== 1) throw new ChatBusinessError('question_not_found')
  const question = questions[0]
  if (question.provider && runtime?.provider !== question.provider) throw new ChatBusinessError('question_bound_to_agent')
  const row = {
    id: `answer:${questionId}`,
    owner_id: ownerId,
    project_id: question.project_id,
    event_id: question.event_id,
    role: 'agent',
    question_id: questionId,
    text: text.trim(),
    created_at: new Date().toISOString(),
    ...(source ? { source } : {}),
    ...(runtime ?? {}),
  }
  const { data, error } = await db.from('lw_chat').insertIfAbsent(row, { onConflict: 'id' }).select('id')
  if (error || !Array.isArray(data)) throw new Error('database_request_failed')
  if (data.length === 1) return { status: 'accepted', answer_id: row.id, question_id: questionId }
  const [existing] = await readRows(db, matches)
  if (!existing) throw new Error('database_request_failed')
  if (existing.text !== row.text) throw new ChatBusinessError('already_answered')
  return { status: 'duplicate', answer_id: existing.id, question_id: questionId }
}

// 按 created_at 升序返回本 owner + 事件的全部消息；用户行带 answered 标记。
export async function listChat(db, { ownerId, eventId }) {
  if (!nonEmpty(ownerId) || !nonEmpty(eventId)) throw new ChatBusinessError('invalid_input')
  const rows = await readRows(db, [['owner_id', ownerId], ['event_id', eventId]])
  const answeredIds = new Set(rows.filter((r) => r.role === 'agent').map((r) => r.question_id))
  return [...rows]
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))
      || (a.role === b.role ? 0 : a.role === 'user' ? -1 : 1)
      || String(a.id).localeCompare(String(b.id)))
    .map((r) => ({
      id: r.id,
      role: r.role,
      question_id: r.role === 'agent' ? r.question_id : null,
      text: r.text,
      created_at: r.created_at,
      ...(r.provider ? { provider: r.provider } : {}),
      ...(r.role === 'user' ? { answered: answeredIds.has(r.id) } : {
        ...(r.source ? { source: r.source } : {}),
        ...(r.model ? { model: r.model, requested_model: r.requested_model, request_id: r.request_id } : {}),
      }),
    }))
}

// 无 agent 回答的用户行（待答问题），可按项目/事件过滤。
export async function listPendingQuestions(db, { ownerId, projectId, eventId }) {
  if (!nonEmpty(ownerId)) throw new ChatBusinessError('invalid_input')
  const filters = [['owner_id', ownerId], ['role', 'user']]
  if (nonEmpty(projectId)) filters.push(['project_id', projectId])
  if (nonEmpty(eventId)) filters.push(['event_id', eventId])
  const questions = await readRows(db, filters)
  const answers = await readRows(db, [['owner_id', ownerId], ['role', 'agent']])
  const answeredIds = new Set(answers.map((r) => r.question_id))
  return questions
    .filter((q) => !q.provider && !answeredIds.has(q.id))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))
    .map((q) => ({
      id: q.id,
      project_id: q.project_id,
      event_id: q.event_id,
      text: q.text,
      created_at: q.created_at,
    }))
}