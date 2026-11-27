// 共享数据模型与提交逻辑：前端 Web 与本地 MCP 工具共用，保证 schema 与规则单一来源。
// 注意：本文件需可被 Node type-stripping 直接运行（不用 enum/namespace/装饰器）。

export interface Source {
  title: string
  url: string
}

export interface Application {
  output_ref: string
  judging: string
  evidence: string
  consequence: string
  verify_action: string
  sources: Source[]
  created_at: string
}

export type Kind = 'concept' | 'operation' | 'fact'

export interface Verification {
  id: string
  text: string
  created_at: string
}

export interface Concept {
  id: string
  title: string
  kind: Kind
  branch: string
  created_at: string
  applications: Application[]
  verifications?: Verification[]
}

export type MarkStatus = 'understood' | 'skipped'

export interface ProjectStore {
  name?: string
  days: Record<string, number>
  outputs: Record<string, number>
  concepts: Concept[]
  marks?: Record<string, MarkStatus>
}

export interface Store {
  projects: Record<string, ProjectStore>
}

export interface SubmitInput {
  project?: string
  output_ref?: string
  title?: string
  kind?: Kind
  judging?: string
  evidence?: string
  consequence?: string
  verify_action?: string
  sources?: { title?: string; url?: string }[]
  branch?: string
}

export const CAP_PER_OUTPUT = 2
export const CAP_PER_DAY = 3
export const KINDS: Kind[] = ['concept', 'operation', 'fact']

const REQUIRED: (keyof SubmitInput)[] = [
  'project',
  'output_ref',
  'title',
  'kind',
  'judging',
  'evidence',
  'consequence',
  'verify_action',
]

export function normTitle(t: string): string {
  return t.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function isHttpUrl(u: string): boolean {
  return /^https?:\/\/\S+$/i.test(u.trim())
}

export function validateSubmit(args: SubmitInput): string[] {
  const missing = REQUIRED.filter((k) => {
    const v = args[k]
    return typeof v !== 'string' || v.trim() === ''
  })
  if (args.kind && !KINDS.includes(args.kind)) missing.push('kind')
  const sourcesOk =
    Array.isArray(args.sources) &&
    args.sources.length > 0 &&
    args.sources.every(
      (s) =>
        s &&
        typeof s.title === 'string' &&
        s.title.trim() !== '' &&
        typeof s.url === 'string' &&
        isHttpUrl(s.url)
    )
  if (!sourcesOk) missing.push('sources')
  return missing
}

export function makeApplication(args: SubmitInput): Application {
  return {
    output_ref: args.output_ref!,
    judging: args.judging!,
    evidence: args.evidence!,
    consequence: args.consequence!,
    verify_action: args.verify_action!,
    sources: (args.sources || []).map((s) => ({
      title: (s.title || '').trim(),
      url: (s.url || '').trim(),
    })),
    created_at: new Date().toISOString(),
  }
}

export interface SubmitResult {
  status: 'accepted' | 'linked' | 'missing_evidence' | 'over_limit'
  node_id?: string
  title?: string
  branch?: string
  missing?: string[]
  scope?: 'output' | 'day'
  limit?: number
  hints: string[]
}

// 纯逻辑：校验 + 上限 + 幂等 + 概念/应用分离。会修改传入 store，返回四态结果（不负责持久化）。
export function applySubmit(store: Store, args: SubmitInput): SubmitResult {
  const missing = validateSubmit(args)
  if (missing.length > 0) {
    return {
      status: 'missing_evidence',
      missing,
      hints: [
        '补齐三问与真实来源后再提交；来源必须先真实搜索，禁止编造 URL。',
        '证据不足时向负责人问一个具体问题，答不上来暂缓提交。',
      ],
    }
  }

  const p = (store.projects[args.project!] ||= {
    days: {},
    outputs: {},
    concepts: [],
  })
  const today = new Date().toISOString().slice(0, 10)
  const outCount = p.outputs[args.output_ref!] || 0
  const dayCount = p.days[today] || 0
  const key = normTitle(args.title!)
  const existing = p.concepts.find((c) => normTitle(c.title) === key)

  if (existing) {
    const sameOutput = existing.applications.find((a) => a.output_ref === args.output_ref)
    if (sameOutput) {
      return {
        status: 'linked',
        node_id: existing.id,
        title: existing.title,
        hints: ['同一份产出重试，沿用已接收结果，不重复计数。'],
      }
    }
    if (outCount >= CAP_PER_OUTPUT) {
      return {
        status: 'over_limit',
        scope: 'output',
        limit: CAP_PER_OUTPUT,
        hints: [`该产出版本已高亮 ${CAP_PER_OUTPUT} 条，本轮收手，不要再换候选提交。`],
      }
    }
    existing.applications.push(makeApplication(args))
    p.outputs[args.output_ref!] = outCount + 1
    return {
      status: 'linked',
      node_id: existing.id,
      title: existing.title,
      hints: ['已关联到既有概念，新增一条应用记录，各留证据。'],
    }
  }

  if (outCount >= CAP_PER_OUTPUT) {
    return {
      status: 'over_limit',
      scope: 'output',
      limit: CAP_PER_OUTPUT,
      hints: [`该产出版本已高亮 ${CAP_PER_OUTPUT} 条，本轮收手，不要再换候选提交。`],
    }
  }
  if (dayCount >= CAP_PER_DAY) {
    return {
      status: 'over_limit',
      scope: 'day',
      limit: CAP_PER_DAY,
      hints: [`该项目今天已新增 ${CAP_PER_DAY} 条推荐，本轮收手，明天再说。`],
    }
  }

  const node: Concept = {
    id: `n_${Math.random().toString(36).slice(2, 10)}`,
    title: args.title!.trim(),
    kind: args.kind!,
    branch: args.branch?.trim() || '未分类',
    created_at: new Date().toISOString(),
    applications: [makeApplication(args)],
    verifications: [],
  }
  p.concepts.push(node)
  p.outputs[args.output_ref!] = outCount + 1
  p.days[today] = dayCount + 1
  return {
    status: 'accepted',
    node_id: node.id,
    title: node.title,
    branch: node.branch,
    hints: ['已入树。可在树上查看并标记理解/跳过、记录验收。'],
  }
}

// ---- 项目更新（项目事件）：任务结束后的收尾记录，与学习点链路独立 ----

export type RevisionType = 'git-commit' | 'workspace-snapshot'

export interface SourceRevision {
  type: RevisionType
  ref: string
  base?: string
  diff_sha256?: string
}

export type ChangeKind = 'code' | 'doc' | 'config' | 'other'
// updated=实际写入且可定位版本；pending=计划中未写入；inferred=仅推断影响，待查
export type ChangeSync = 'updated' | 'pending' | 'inferred'

export interface ChangeItem {
  target: string
  summary: string
  kind: ChangeKind
  sync: ChangeSync
}

export interface ChangeInput {
  target: string
  summary: string
  kind?: ChangeKind
  sync?: ChangeSync
}

export interface DecisionItem {
  decision: string
  reason: string
}

export type VerificationStatus = 'verified' | 'unverified'

export interface VerificationItem {
  item: string
  status: VerificationStatus
  revision?: string
  environment?: string
  scope?: string
  evidence?: string
}

export interface RiskItem {
  text: string
  kind: 'risk' | 'unknown'
}

export interface LearningCandidate {
  title: string
  note?: string
}

export interface ProjectUpdateInput {
  project?: string
  task_id?: string
  run_id?: string
  task_title?: string
  source_revision?: SourceRevision
  agent_report?: string
  outcome?: string
  changes?: ChangeInput[]
  decisions?: DecisionItem[]
  verifications?: VerificationItem[]
  risks?: RiskItem[]
  learning_candidates?: LearningCandidate[]
}

export interface UserAcceptance {
  status: 'accepted' | 'rejected'
  note?: string
  at: string
}

export interface ProjectEvent {
  id: string
  owner_id: string
  project_id: string
  task_id: string
  run_id: string
  task_title: string
  source_revision: SourceRevision
  agent_report: string
  outcome?: string
  changes: ChangeItem[]
  decisions: DecisionItem[]
  verifications: VerificationItem[]
  risks: RiskItem[]
  learning_candidates: LearningCandidate[]
  content_hash: string
  created_at: string
  received_at: string
  acceptance: UserAcceptance | null
}

export interface ProjectUpdateResult {
  status: 'accepted' | 'duplicate' | 'conflict' | 'invalid'
  event_id?: string
  missing?: string[]
  hints: string[]
}

const CHANGE_KINDS: ChangeKind[] = ['code', 'doc', 'config', 'other']
const CHANGE_SYNCS: ChangeSync[] = ['updated', 'pending', 'inferred']

function nonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}

export function validateProjectUpdate(args: ProjectUpdateInput): string[] {
  const missing: string[] = []
  for (const k of ['project', 'task_id', 'run_id', 'task_title', 'agent_report'] as const) {
    if (!nonEmpty(args[k])) missing.push(k)
  }
  const rev = args.source_revision
  if (!rev || (rev.type !== 'git-commit' && rev.type !== 'workspace-snapshot') || !nonEmpty(rev.ref)) {
    missing.push('source_revision')
  } else if (rev.type === 'workspace-snapshot' && (!nonEmpty(rev.base) || !nonEmpty(rev.diff_sha256))) {
    missing.push('source_revision.base/diff_sha256')
  }
  if (!Array.isArray(args.changes) || args.changes.length === 0) {
    missing.push('changes')
  } else {
    args.changes.forEach((c, i) => {
      if (!c || !nonEmpty(c.target) || !nonEmpty(c.summary)) missing.push(`changes[${i}]`)
      else {
        if (c.kind && !CHANGE_KINDS.includes(c.kind)) missing.push(`changes[${i}].kind`)
        if (c.sync && !CHANGE_SYNCS.includes(c.sync)) missing.push(`changes[${i}].sync`)
      }
    })
  }
  if (!Array.isArray(args.verifications)) {
    missing.push('verifications')
  } else {
    args.verifications.forEach((v, i) => {
      if (!v || !nonEmpty(v.item) || (v.status !== 'verified' && v.status !== 'unverified')) {
        missing.push(`verifications[${i}]`)
      } else if (v.status === 'verified' && !nonEmpty(v.evidence)) {
        // 没有实际证据不得标 verified：Agent 声明不能伪装成测试通过
        missing.push(`verifications[${i}].evidence`)
      }
    })
  }
  if (args.decisions !== undefined) {
    if (!Array.isArray(args.decisions)) missing.push('decisions')
    else args.decisions.forEach((d, i) => {
      if (!d || !nonEmpty(d.decision) || !nonEmpty(d.reason)) missing.push(`decisions[${i}]`)
    })
  }
  if (args.risks !== undefined) {
    if (!Array.isArray(args.risks)) missing.push('risks')
    else args.risks.forEach((r, i) => {
      if (!r || !nonEmpty(r.text) || (r.kind !== 'risk' && r.kind !== 'unknown')) missing.push(`risks[${i}]`)
    })
  }
  if (args.learning_candidates !== undefined) {
    if (!Array.isArray(args.learning_candidates)) missing.push('learning_candidates')
    else args.learning_candidates.forEach((l, i) => {
      if (!l || !nonEmpty(l.title)) missing.push(`learning_candidates[${i}]`)
    })
  }
  return missing
}

export function normalizeProjectUpdate(args: ProjectUpdateInput) {
  return {
    project_id: args.project!.trim(),
    task_id: args.task_id!.trim(),
    run_id: args.run_id!.trim(),
    task_title: args.task_title!.trim(),
    source_revision: {
      type: args.source_revision!.type,
      ref: args.source_revision!.ref.trim(),
      ...(nonEmpty(args.source_revision!.base) ? { base: args.source_revision!.base!.trim() } : {}),
      ...(nonEmpty(args.source_revision!.diff_sha256) ? { diff_sha256: args.source_revision!.diff_sha256!.trim() } : {}),
    },
    agent_report: args.agent_report!.trim(),
    ...(nonEmpty(args.outcome) ? { outcome: args.outcome!.trim() } : {}),
    changes: args.changes!.map((c) => ({
      target: c.target.trim(),
      summary: c.summary.trim(),
      kind: c.kind || 'code',
      sync: c.sync || 'updated',
    })),
    decisions: (args.decisions || []).map((d) => ({ decision: d.decision.trim(), reason: d.reason.trim() })),
    verifications: args.verifications!.map((v) => ({
      item: v.item.trim(),
      status: v.status,
      ...(nonEmpty(v.revision) ? { revision: v.revision!.trim() } : {}),
      ...(nonEmpty(v.environment) ? { environment: v.environment!.trim() } : {}),
      ...(nonEmpty(v.scope) ? { scope: v.scope!.trim() } : {}),
      ...(nonEmpty(v.evidence) ? { evidence: v.evidence!.trim() } : {}),
    })),
    risks: (args.risks || []).map((r) => ({ text: r.text.trim(), kind: r.kind })),
    learning_candidates: (args.learning_candidates || []).map((l) => ({
      title: l.title.trim(),
      ...(nonEmpty(l.note) ? { note: l.note!.trim() } : {}),
    })),
  }
}

// 幂等身份 = owner + project + task_id + run_id（事件 ID 由调用方确定性生成）。
// 同身份同内容 → duplicate 返回原事件；同身份不同内容 → conflict，不覆盖。
export function applyProjectUpdate(
  existing: ProjectEvent | null,
  args: ProjectUpdateInput,
  id: string,
  ownerId: string,
  receivedAt: string,
  contentHash: string,
): { result: ProjectUpdateResult; event: ProjectEvent | null } {
  const missing = validateProjectUpdate(args)
  if (missing.length > 0) {
    return {
      result: { status: 'invalid', missing, hints: ['补齐必填字段；verified 必须附实际证据。修正后再提交，不要换身份绕过。'] },
      event: null,
    }
  }
  if (existing) {
    if (existing.content_hash === contentHash) {
      return {
        result: { status: 'duplicate', event_id: existing.id, hints: ['相同提交身份与内容已保存，返回原事件，不产生新记录。'] },
        event: null,
      }
    }
    return {
      result: { status: 'conflict', event_id: existing.id, hints: ['该任务轮次已有内容不同的事件。请核对原事件；新一轮工作请用新的 run_id。'] },
      event: null,
    }
  }
  const event: ProjectEvent = {
    id,
    owner_id: ownerId,
    ...normalizeProjectUpdate(args),
    content_hash: contentHash,
    created_at: receivedAt,
    received_at: receivedAt,
    acceptance: null,
  }
  return {
    result: { status: 'accepted', event_id: id, hints: ['已保存。刷新项目更新页可见；用户验收保持未记录，由用户亲自操作。'] },
    event,
  }
}

// 证据版本归属：verified 证据只属于它实际执行的版本，不自动继承到新版本
export function verificationFreshness(v: VerificationItem, event: ProjectEvent): 'unverified' | 'unversioned' | 'current' | 'stale' {
  if (v.status !== 'verified') return 'unverified'
  if (!nonEmpty(v.revision)) return 'unversioned'
  return v.revision === event.source_revision.ref ? 'current' : 'stale'
}
