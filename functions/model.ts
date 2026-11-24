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
