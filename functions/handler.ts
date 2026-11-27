import { assembleStore, conceptUuid, isUuid, planProjectUpdate, planSubmit, projectEventUuid, projectUpdateHash, stableUuid, validateProjectUpdate } from './core.ts'
import {
  DuplicateRowError,
  acceptEvent,
  conceptExists,
  findEvent,
  insertApplication,
  insertConcept,
  insertEvent,
  insertVerification,
  loadEvents,
  loadRows,
  removeConceptRows,
  removeEmptyConcept,
  upsertMark,
  type DatabaseClient,
} from './database.ts'
import type { ProjectUpdateInput, ProjectUpdateResult, SubmitInput, UserAcceptance } from './model.ts'

const MAX_BODY_BYTES = 32 * 1024
const WRITE_ACTIONS = new Set(['submit', 'mark', 'verify', 'delete', 'update', 'accept'])

class PayloadError extends Error {
  code: 'invalid_payload' | 'payload_too_large'

  constructor(code: 'invalid_payload' | 'payload_too_large') {
    super(code)
    this.code = code
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer', ...headers } })
}

async function payload(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    throw new PayloadError('invalid_payload')
  }
  const reader = request.body?.getReader()
  if (!reader) throw new PayloadError('invalid_payload')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_BODY_BYTES) {
        await reader.cancel()
        throw new PayloadError('payload_too_large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    throw new PayloadError('invalid_payload')
  }
}

function textField(body: Record<string, unknown>, key: string): string {
  return typeof body[key] === 'string' ? body[key].trim() : ''
}

function actionFrom(request: Request): string | null {
  const path = new URL(request.url).pathname.match(/\/api\/(store|submit|mark|verify|delete|updates|update|accept)$/)
  if (path) return path[1]
  const action = new URL(request.url).searchParams.get('action')
  return action && (action === 'store' || action === 'updates' || WRITE_ACTIONS.has(action)) ? action : null
}

export async function submit(db: DatabaseClient, ownerId: string, input: SubmitInput, receivedAt: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const rows = await loadRows(db, ownerId)
    const id = await conceptUuid(ownerId, input.project || '', input.title || '')
    const plan = planSubmit(assembleStore(rows), input, id, ownerId)
    if (!plan.concept && !plan.application) return plan.result

    if (plan.concept) {
      try {
        await insertConcept(db, plan.concept)
      } catch (error) {
        if (error instanceof DuplicateRowError) continue
        throw error
      }
    }

    if (plan.application) {
      const application = {
        ...plan.application,
        id: await stableUuid(['application', plan.application.concept_id, plan.application.output_ref]),
        received_at: receivedAt,
      }
      try {
        await insertApplication(db, application)
      } catch (error) {
        if (error instanceof DuplicateRowError) continue
        if (plan.concept) {
          try {
            await removeEmptyConcept(db, ownerId, plan.concept.id)
          } catch {
            // 补偿删除失败时保留数据库错误语义，不记录原始供应商错误。
          }
        }
        throw error
      }
    }
    return plan.result
  }
  throw new Error('database_request_failed')
}

// 项目事件提交：先校验（invalid 不触库），再按确定性身份查重，最后插入；
// 唯一键冲突说明并发写入，重读对账（同内容 duplicate / 异内容 conflict），不盲目重发。
export async function submitProjectUpdate(db: DatabaseClient, ownerId: string, input: ProjectUpdateInput, receivedAt: string): Promise<ProjectUpdateResult> {
  const missing = validateProjectUpdate(input)
  if (missing.length > 0) {
    return { status: 'invalid', missing, hints: ['补齐必填字段；verified 必须附实际证据。修正后再提交，不要换身份绕过。'] }
  }
  const id = await projectEventUuid(ownerId, input.project!, input.task_id!, input.run_id!)
  const contentHash = await projectUpdateHash(input)
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await findEvent(db, ownerId, id)
    const plan = planProjectUpdate(existing, input, id, ownerId, receivedAt, contentHash)
    if (!plan.event) return plan.result
    try {
      await insertEvent(db, plan.event)
    } catch (error) {
      if (error instanceof DuplicateRowError) continue
      throw error
    }
    return plan.result
  }
  throw new Error('database_request_failed')
}

export async function handleLearningStore({ request, db, ownerId }: {
  request: Request
  db: DatabaseClient
  ownerId: string
}) {
  const action = actionFrom(request)
  if (!action) return json({ error: 'not_found' }, 404)
  if (action === 'store') {
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET' })
    try {
      return json(assembleStore(await loadRows(db, ownerId)))
    } catch {
      return json({ error: 'database_request_failed' }, 503)
    }
  }

  if (action === 'updates') {
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET' })
    try {
      const url = new URL(request.url)
      const project = url.searchParams.get('project')?.trim() || ''
      const taskId = url.searchParams.get('task_id')?.trim() || ''
      const runId = url.searchParams.get('run_id')?.trim() || ''
      const eventId = url.searchParams.get('event_id')?.trim() || ''
      let events = await loadEvents(db, ownerId)
      if (project) events = events.filter((e) => e.project_id === project)
      if (taskId) events = events.filter((e) => e.task_id === taskId)
      if (runId) events = events.filter((e) => e.run_id === runId)
      if (eventId) events = events.filter((e) => e.id === eventId)
      return json({ events })
    } catch {
      return json({ error: 'database_request_failed' }, 503)
    }
  }

  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' })
  let body: Record<string, unknown>
  try {
    body = await payload(request)
  } catch (error) {
    if (error instanceof PayloadError) return json({ error: error.code }, error.code === 'payload_too_large' ? 413 : 400)
    return json({ error: 'invalid_payload' }, 400)
  }
  const project = textField(body, 'project')
  if (!project) return json({ error: 'invalid_payload' }, 400)
  const receivedAt = new Date().toISOString()

  try {
    if (action === 'submit') {
      const input = { ...body, project } as SubmitInput
      return json(await submit(db, ownerId, input, receivedAt))
    }

    if (action === 'update') {
      const input = { ...body, project } as ProjectUpdateInput
      return json(await submitProjectUpdate(db, ownerId, input, receivedAt))
    }

    if (action === 'accept') {
      const eventId = textField(body, 'event_id')
      const decision = textField(body, 'decision')
      if (!isUuid(eventId) || (decision !== 'accepted' && decision !== 'rejected')) return json({ error: 'invalid_payload' }, 400)
      const note = textField(body, 'note')
      const existing = await findEvent(db, ownerId, eventId)
      if (!existing || existing.project_id !== project) return json({ error: 'event_not_found' }, 404)
      const acceptance: UserAcceptance = { status: decision, ...(note ? { note } : {}), at: receivedAt }
      await acceptEvent(db, ownerId, eventId, acceptance)
      return json({ ok: true, acceptance })
    }

    const conceptId = textField(body, 'concept_id')
    if (!isUuid(conceptId)) return json({ error: 'invalid_payload' }, 400)
    if (!await conceptExists(db, ownerId, project, conceptId)) return json({ error: 'concept_not_found' }, 404)

    if (action === 'mark') {
      const status = textField(body, 'status')
      if (status !== 'understood' && status !== 'skipped') return json({ error: 'invalid_payload' }, 400)
      await upsertMark(db, {
        id: await stableUuid(['mark', ownerId, project, conceptId]),
        owner_id: ownerId,
        project_id: project,
        concept_id: conceptId,
        status,
        updated_at: receivedAt,
      })
      return json({ ok: true })
    }

    if (action === 'verify') {
      const text = textField(body, 'text')
      if (!text) return json({ error: 'invalid_payload' }, 400)
      await insertVerification(db, {
        id: crypto.randomUUID(),
        concept_id: conceptId,
        text,
        created_at: receivedAt,
      })
      return json({ ok: true })
    }

    await removeConceptRows(db, ownerId, project, conceptId)
    return json({ ok: true })
  } catch {
    return json({ error: 'database_request_failed' }, 503)
  }
}
