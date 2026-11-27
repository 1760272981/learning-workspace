import { applySubmit, applyProjectUpdate, normTitle, normalizeProjectUpdate, validateProjectUpdate, type ProjectEvent, type ProjectUpdateInput, type ProjectUpdateResult, type Store, type SubmitInput, type SubmitResult } from './model.ts'

export interface ConceptRow {
  id: string
  owner_id: string
  project_id: string
  title: string
  kind: 'concept' | 'operation' | 'fact'
  branch: string
  created_at: string
  version: number
}

export interface ApplicationRow {
  id: string
  concept_id: string
  output_ref: string
  judging: string
  evidence: string
  consequence: string
  verify_action: string
  sources: { title: string; url: string }[]
  created_at: string
  received_at: string
}

export interface VerificationRow {
  id: string
  concept_id: string
  text: string
  created_at: string
}

export interface MarkRow {
  id: string
  owner_id: string
  project_id: string
  concept_id: string
  status: 'understood' | 'skipped'
  updated_at: string
}

export interface StoreRows {
  concepts: ConceptRow[]
  applications: ApplicationRow[]
  verifications: VerificationRow[]
  marks: MarkRow[]
}

export interface SubmitPlan {
  result: SubmitResult
  concept: ConceptRow | null
  application: ApplicationRow | null
}

export function assembleStore(rows: StoreRows): Store {
  const store: Store = { projects: {} }
  const byId = new Map<string, { projectId: string; concept: Store['projects'][string]['concepts'][number] }>()

  for (const row of [...rows.concepts].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))) {
    const project = (store.projects[row.project_id] ||= { days: {}, outputs: {}, concepts: [] })
    const concept = {
      id: row.id,
      title: row.title,
      kind: row.kind,
      branch: row.branch,
      created_at: row.created_at,
      applications: [],
      verifications: [],
    }
    project.concepts.push(concept)
    byId.set(row.id, { projectId: row.project_id, concept })
  }

  const applications = [...rows.applications].sort((a, b) => a.received_at.localeCompare(b.received_at) || a.id.localeCompare(b.id))
  for (const row of applications) {
    const target = byId.get(row.concept_id)
    if (!target) continue
    target.concept.applications.push({
      output_ref: row.output_ref,
      judging: row.judging,
      evidence: row.evidence,
      consequence: row.consequence,
      verify_action: row.verify_action,
      sources: row.sources,
      created_at: row.created_at,
    })
    const project = store.projects[target.projectId]
    project.outputs[row.output_ref] = (project.outputs[row.output_ref] || 0) + 1
    const first = target.concept.applications.length === 1
    if (first) {
      const day = row.received_at.slice(0, 10)
      project.days[day] = (project.days[day] || 0) + 1
    }
  }

  for (const row of [...rows.verifications].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))) {
    const target = byId.get(row.concept_id)
    if (target) target.concept.verifications!.push({ id: row.id, text: row.text, created_at: row.created_at })
  }

  for (const row of rows.marks) {
    const target = byId.get(row.concept_id)
    if (target && target.projectId === row.project_id && (row.status === 'understood' || row.status === 'skipped')) {
      const project = store.projects[row.project_id]
      project.marks ||= {}
      project.marks[row.concept_id] = row.status
    }
  }

  return store
}

export function planSubmit(store: Store, input: SubmitInput, conceptId: string, ownerId: string): SubmitPlan {
  const next = structuredClone(store)
  const before = new Map(next.projects[input.project!]?.concepts.map((concept) => [concept.id, concept.applications.length]) || [])
  const result = applySubmit(next, input)
  if (result.status !== 'accepted' && result.status !== 'linked') return { result, concept: null, application: null }

  const projectId = input.project!
  const concept = next.projects[projectId].concepts.find((item) => item.id === result.node_id)!
  if (result.status === 'accepted') {
    concept.id = conceptId
    result.node_id = conceptId
  }

  const previousCount = before.get(concept.id) || 0
  const added = concept.applications.length > previousCount ? concept.applications[concept.applications.length - 1] : null
  return {
    result,
    concept: result.status === 'accepted' ? {
      id: concept.id,
      owner_id: ownerId,
      project_id: projectId,
      title: concept.title,
      kind: concept.kind,
      branch: concept.branch,
      created_at: concept.created_at,
      version: 1,
    } : null,
    application: added ? {
      id: '',
      concept_id: concept.id,
      output_ref: added.output_ref,
      judging: added.judging,
      evidence: added.evidence,
      consequence: added.consequence,
      verify_action: added.verify_action,
      sources: added.sources,
      created_at: added.created_at,
      received_at: '',
    } : null,
  }
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export async function stableUuid(parts: string[]): Promise<string> {
  const input = new TextEncoder().encode(parts.join('\u0000'))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input))
  const hex = Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const chars = hex.split('')
  chars[12] = '8'
  chars[16] = ((Number.parseInt(chars[16], 16) & 3) | 8).toString(16)
  return `${chars.slice(0, 8).join('')}-${chars.slice(8, 12).join('')}-${chars.slice(12, 16).join('')}-${chars.slice(16, 20).join('')}-${chars.slice(20, 32).join('')}`
}

export function conceptUuid(ownerId: string, projectId: string, title: string): Promise<string> {
  return stableUuid(['concept', ownerId, projectId, normTitle(title)])
}

// ---- 项目事件 ----

export function projectEventUuid(ownerId: string, projectId: string, taskId: string, runId: string): Promise<string> {
  return stableUuid(['project-event', ownerId, projectId.trim(), taskId.trim(), runId.trim()])
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// 内容指纹只覆盖规范化后的业务字段，不含身份/时间/验收，重放同内容得到同指纹
export function projectUpdateHash(input: ProjectUpdateInput): Promise<string> {
  return sha256Hex(JSON.stringify(normalizeProjectUpdate(input)))
}

export function planProjectUpdate(
  existing: ProjectEvent | null,
  input: ProjectUpdateInput,
  id: string,
  ownerId: string,
  receivedAt: string,
  contentHash: string,
): { result: ProjectUpdateResult; event: ProjectEvent | null } {
  return applyProjectUpdate(existing, input, id, ownerId, receivedAt, contentHash)
}

export { validateProjectUpdate }
