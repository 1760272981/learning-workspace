import { assembleStore } from '../functions/core.ts'
import { loadEvents, loadRows } from '../functions/database.ts'
import { submit, submitProjectUpdate } from '../functions/handler.ts'
import type { ProjectEvent, ProjectUpdateInput, ProjectUpdateResult, SubmitInput, SubmitResult } from '../shared/model.ts'
import { createFileDb, DEFAULT_LOCAL_DATA_FILE, LOCAL_OWNER } from '../scripts/file-db.mjs'
import { insertAnswer, listChat, listPendingQuestions, type AnswerResult } from '../scripts/chat-store.mjs'

let localDb

export async function submitToLocal(input: SubmitInput): Promise<SubmitResult | { status: 'pending', pending: true, error: string, hints: string[] }> {
  try {
    localDb ||= createFileDb(process.env.LW_LOCAL_DATA_FILE || DEFAULT_LOCAL_DATA_FILE)
    return await submit(localDb, LOCAL_OWNER, input, new Date().toISOString())
  } catch {
    return { status: 'pending', pending: true, error: 'write_result_unknown', hints: ['本地数据文件未能确认写入结果，不要自动重发。先读取网页，按原 project + output_ref + 规范标题对账。'] }
  }
}

export async function readLocalStore() {
  localDb ||= createFileDb(process.env.LW_LOCAL_DATA_FILE || DEFAULT_LOCAL_DATA_FILE)
  return assembleStore(await loadRows(localDb, LOCAL_OWNER))
}

export async function submitUpdateToLocal(input: ProjectUpdateInput): Promise<ProjectUpdateResult | { status: 'pending', pending: true, error: string, hints: string[] }> {
  try {
    localDb ||= createFileDb(process.env.LW_LOCAL_DATA_FILE || DEFAULT_LOCAL_DATA_FILE)
    return await submitProjectUpdate(localDb, LOCAL_OWNER, input, new Date().toISOString())
  } catch {
    return { status: 'pending', pending: true, error: 'write_result_unknown', hints: ['本地数据文件未能确认写入结果，不要自动重发。先用 read_project_updates 按原 project + task_id + run_id 查回事件对账。'] }
  }
}

export async function readLocalUpdates(params: { project?: string; task_id?: string; run_id?: string; event_id?: string }): Promise<ProjectEvent[]> {
  localDb ||= createFileDb(process.env.LW_LOCAL_DATA_FILE || DEFAULT_LOCAL_DATA_FILE)
  let events = await loadEvents(localDb, LOCAL_OWNER)
  if (params.project?.trim()) events = events.filter((e) => e.project_id === params.project!.trim())
  if (params.task_id?.trim()) events = events.filter((e) => e.task_id === params.task_id!.trim())
  if (params.run_id?.trim()) events = events.filter((e) => e.run_id === params.run_id!.trim())
  if (params.event_id?.trim()) events = events.filter((e) => e.id === params.event_id!.trim())
  return events
}

// ---- 页面问答桥（仅本地）：读待答问题 / 写回回答 ----

export async function readLocalQuestions(params: { project?: string; event_id?: string }) {
  const db = localDb ||= createFileDb(process.env.LW_LOCAL_DATA_FILE || DEFAULT_LOCAL_DATA_FILE)
  const pending = await listPendingQuestions(db, {
    ownerId: LOCAL_OWNER,
    projectId: params.project?.trim() || undefined,
    eventId: params.event_id?.trim() || undefined,
  })
  const threads = new Map(await Promise.all([...new Set(pending.map((q) => q.event_id))].map(async (eventId) => (
    [eventId, await listChat(db, { ownerId: LOCAL_OWNER, eventId })] as const
  ))))
  return pending.map((q) => {
    const thread = threads.get(q.event_id) ?? []
    const index = thread.findIndex((m) => m.id === q.id)
    return { ...q, recent_messages: index < 0 ? [] : thread.slice(Math.max(0, index - 6), index) }
  })
}

export async function answerLocalQuestion(params: { question_id?: string; answer?: string }): Promise<AnswerResult> {
  localDb ||= createFileDb(process.env.LW_LOCAL_DATA_FILE || DEFAULT_LOCAL_DATA_FILE)
  return insertAnswer(localDb, {
    ownerId: LOCAL_OWNER,
    questionId: (params.question_id || '').trim(),
    text: params.answer || '',
  })
}
