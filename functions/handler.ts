import { assembleStore, conceptUuid, isUuid, planSubmit, stableUuid } from './core.ts'
import {
  DuplicateRowError,
  conceptExists,
  insertApplication,
  insertConcept,
  insertVerification,
  loadRows,
  removeConceptRows,
  removeEmptyConcept,
  upsertMark,
  type DatabaseClient,
} from './database.ts'
import type { SubmitInput } from './model.ts'

const MAX_BODY_BYTES = 32 * 1024
const WRITE_ACTIONS = new Set(['submit', 'mark', 'verify', 'delete'])

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
  const path = new URL(request.url).pathname.match(/\/api\/(store|submit|mark|verify|delete)$/)
  if (path) return path[1]
  const action = new URL(request.url).searchParams.get('action')
  return action && (action === 'store' || WRITE_ACTIONS.has(action)) ? action : null
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
