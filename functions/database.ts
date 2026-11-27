import type { ApplicationRow, ConceptRow, MarkRow, StoreRows, VerificationRow } from './core.ts'
import type { ProjectEvent, UserAcceptance } from './model.ts'

interface DatabaseError {
  code?: string
  status?: number
}

export type DbRow = Record<string, unknown>
export interface QueryResult {
  data: DbRow[] | null
  error: DatabaseError | null
}
export interface QueryBuilder extends PromiseLike<QueryResult> {
  select(columns: string): QueryBuilder
  order(column: string, options?: { ascending?: boolean }): QueryBuilder
  range(from: number, to: number): QueryBuilder
  limit(count: number): QueryBuilder
  eq(column: string, value: string): QueryBuilder
  insertIfAbsent(row: DbRow, options: { onConflict: string }): QueryBuilder
  update(row: DbRow): QueryBuilder
  delete(): QueryBuilder
}
export interface TableClient {
  select(columns: string): QueryBuilder
  insertIfAbsent(row: DbRow, options: { onConflict: string }): QueryBuilder
  update(row: DbRow): QueryBuilder
  delete(): QueryBuilder
}
export interface DatabaseClient {
  from(table: string): TableClient
}

export class DuplicateRowError extends Error {}

function query(db: DatabaseClient, table: string): TableClient {
  return db.from(table)
}

function failed(error: DatabaseError | null): error is DatabaseError {
  return !!error
}

export async function loadRows(db: DatabaseClient, ownerId: string): Promise<StoreRows> {
  async function all(table: string, columns: string, scoped = false): Promise<DbRow[]> {
    const rows: DbRow[] = []
    for (let offset = 0; ; offset += 500) {
      let builder = query(db, table).select(columns).order('id').range(offset, offset + 499)
      if (scoped) builder = builder.eq('owner_id', ownerId)
      const { data, error } = await builder
      if (failed(error) || !Array.isArray(data)) throw new Error('database_request_failed')
      rows.push(...data)
      if (data.length < 500) return rows
    }
  }

  const concepts = await all('lw_concepts', 'id,owner_id,project_id,title,kind,branch,created_at,version', true)
  const ownedConceptIds = new Set(concepts.map((row) => row.id))
  const [applications, verifications, marks] = await Promise.all([
    all('lw_applications', 'id,concept_id,output_ref,judging,evidence,consequence,verify_action,sources,created_at,received_at'),
    all('lw_verifications', 'id,concept_id,text,created_at'),
    all('lw_marks', 'id,owner_id,project_id,concept_id,status,updated_at', true),
  ])
  return {
    concepts: concepts.filter((row) => row.owner_id === ownerId),
    applications: applications.filter((row) => ownedConceptIds.has(row.concept_id)),
    verifications: verifications.filter((row) => ownedConceptIds.has(row.concept_id)),
    marks: marks.filter((row) => row.owner_id === ownerId && ownedConceptIds.has(row.concept_id)),
  } as unknown as StoreRows
}

async function write(operation: PromiseLike<QueryResult>): Promise<void> {
  const { error } = await operation
  if (!failed(error)) return
  if (error.code === '23505') throw new DuplicateRowError()
  throw new Error('database_request_failed')
}

async function insertUnique(operation: PromiseLike<QueryResult>): Promise<void> {
  const { data, error } = await operation
  if (failed(error)) {
    if (error.code === '23505') throw new DuplicateRowError()
    throw new Error('database_request_failed')
  }
  if (!Array.isArray(data) || data.length !== 1) throw new DuplicateRowError()
}

export function insertConcept(db: DatabaseClient, row: ConceptRow): Promise<void> {
  return insertUnique(query(db, 'lw_concepts').insertIfAbsent({ ...row }, { onConflict: 'id' }).select('id'))
}

export function insertApplication(db: DatabaseClient, row: ApplicationRow): Promise<void> {
  return insertUnique(query(db, 'lw_applications').insertIfAbsent({ ...row }, { onConflict: 'concept_id,output_ref' }).select('id'))
}

export async function upsertMark(db: DatabaseClient, row: MarkRow): Promise<void> {
  const inserted = await query(db, 'lw_marks').insertIfAbsent({ ...row }, { onConflict: 'project_id,concept_id' }).select('id')
  if (failed(inserted.error)) {
    if (inserted.error.code === '23505') throw new DuplicateRowError()
    throw new Error('database_request_failed')
  }
  if (Array.isArray(inserted.data) && inserted.data.length === 1) return
  const updated = await query(db, 'lw_marks')
    .update({ status: row.status, updated_at: row.updated_at })
    .eq('project_id', row.project_id)
    .eq('concept_id', row.concept_id)
    .eq('owner_id', row.owner_id)
    .select('id')
  if (failed(updated.error) || !Array.isArray(updated.data) || updated.data.length !== 1) {
    throw new Error('database_request_failed')
  }
}

export function insertVerification(db: DatabaseClient, row: VerificationRow): Promise<void> {
  return insertUnique(query(db, 'lw_verifications').insertIfAbsent({ ...row }, { onConflict: 'id' }).select('id'))
}

export async function conceptExists(db: DatabaseClient, ownerId: string, projectId: string, conceptId: string): Promise<boolean> {
  const { data, error } = await query(db, 'lw_concepts').select('id')
    .eq('owner_id', ownerId).eq('project_id', projectId).eq('id', conceptId).limit(1)
  if (failed(error) || !Array.isArray(data)) throw new Error('database_request_failed')
  return data.length === 1
}

export async function removeConceptRows(db: DatabaseClient, ownerId: string, projectId: string, conceptId: string): Promise<void> {
  for (const table of ['lw_applications', 'lw_verifications']) {
    const { error } = await query(db, table).delete().eq('concept_id', conceptId)
    if (failed(error)) throw new Error('database_request_failed')
  }
  const marks = await query(db, 'lw_marks').delete().eq('owner_id', ownerId).eq('project_id', projectId).eq('concept_id', conceptId)
  if (failed(marks.error)) throw new Error('database_request_failed')
  const concept = await query(db, 'lw_concepts').delete().eq('owner_id', ownerId).eq('project_id', projectId).eq('id', conceptId).select('id')
  if (failed(concept.error) || !Array.isArray(concept.data) || concept.data.length !== 1) {
    throw new Error('database_request_failed')
  }
}

export function removeEmptyConcept(db: DatabaseClient, ownerId: string, conceptId: string): Promise<void> {
  return write(query(db, 'lw_concepts').delete().eq('owner_id', ownerId).eq('id', conceptId))
}

// ---- 项目事件（lw_events）：payload 存整份事件（不含 acceptance），列供查询 ----

export interface EventRow {
  id: string
  owner_id: string
  project_id: string
  task_id: string
  run_id: string
  content_hash: string
  payload: Omit<ProjectEvent, 'acceptance'>
  created_at: string
  received_at: string
  acceptance: UserAcceptance | null
}

function rowToEvent(row: EventRow): ProjectEvent {
  return { ...(row.payload as Omit<ProjectEvent, 'acceptance'>), acceptance: (row.acceptance as UserAcceptance | null) ?? null }
}

export async function loadEvents(db: DatabaseClient, ownerId: string): Promise<ProjectEvent[]> {
  const rows: DbRow[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await query(db, 'lw_events')
      .select('id,owner_id,project_id,task_id,run_id,content_hash,payload,created_at,received_at,acceptance')
      .eq('owner_id', ownerId).order('id').range(offset, offset + 499)
    if (failed(error) || !Array.isArray(data)) throw new Error('database_request_failed')
    rows.push(...data)
    if (data.length < 500) break
  }
  return (rows as unknown as EventRow[])
    .map(rowToEvent)
    .sort((a, b) => b.received_at.localeCompare(a.received_at) || b.id.localeCompare(a.id))
}

export async function findEvent(db: DatabaseClient, ownerId: string, eventId: string): Promise<ProjectEvent | null> {
  const { data, error } = await query(db, 'lw_events')
    .select('id,owner_id,project_id,task_id,run_id,content_hash,payload,created_at,received_at,acceptance')
    .eq('owner_id', ownerId).eq('id', eventId).limit(1)
  if (failed(error) || !Array.isArray(data)) throw new Error('database_request_failed')
  return data.length === 1 ? rowToEvent(data[0] as unknown as EventRow) : null
}

export function insertEvent(db: DatabaseClient, event: ProjectEvent): Promise<void> {
  const { acceptance, ...payload } = event
  const row: EventRow = {
    id: event.id,
    owner_id: event.owner_id,
    project_id: event.project_id,
    task_id: event.task_id,
    run_id: event.run_id,
    content_hash: event.content_hash,
    payload,
    created_at: event.created_at,
    received_at: event.received_at,
    acceptance,
  }
  return insertUnique(query(db, 'lw_events').insertIfAbsent({ ...row }, { onConflict: 'id' }).select('id'))
}

export async function acceptEvent(db: DatabaseClient, ownerId: string, eventId: string, acceptance: UserAcceptance): Promise<void> {
  const { data, error } = await query(db, 'lw_events')
    .update({ acceptance })
    .eq('id', eventId).eq('owner_id', ownerId)
    .select('id')
  if (failed(error) || !Array.isArray(data) || data.length !== 1) throw new Error('database_request_failed')
}
