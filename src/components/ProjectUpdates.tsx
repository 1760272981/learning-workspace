import { useState, useRef, type ReactNode } from 'react'
import type { Concept, ProjectEvent, Store, VerificationItem } from '../types'
import { verificationFreshness } from '../types'
import { EventChat } from './EventChat'

interface Props {
  events: ProjectEvent[]
  initialEventId: string | null
  onBackFromEvent: () => void
  loading: boolean
  error: string | null
  onClearError: () => void
  onRefresh: () => void
  onAccept: (event: ProjectEvent, decision: 'accepted' | 'rejected', note?: string) => Promise<unknown>
  projects: Store['projects']
  onOpenConcept: (projectId: string, id: string) => void
  chatEnabled: boolean
}

const fmtTime = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false })
}

const truncate = (text: string, limit: number) => text.length > limit ? `${text.slice(0, limit)}…` : text

function cardPendingItem(event: ProjectEvent) {
  const verification = event.verifications.find((v) => v.status === 'unverified')
  if (verification) return verification.item
  if (event.risks.length > 0) return event.risks[0].text
  const change = event.changes.find((c) => c.sync !== 'updated')
  return change ? `${change.target}：${change.summary}` : null
}

function VerificationBadge({ v, event }: { v: VerificationItem; event: ProjectEvent }) {
  const freshness = verificationFreshness(v, event)
  if (freshness === 'unverified') return <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] bg-slate-100 border border-slate-300 text-slate-600">未验证</span>
  if (freshness === 'current') return <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] bg-leaf-100 border border-leaf-300 text-leaf-800">实测通过 · 本版本</span>
  if (freshness === 'stale') return <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] bg-honey-100 border border-honey-300 text-honey-700">旧版本证据 · 待复验</span>
  return <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] bg-honey-100 border border-honey-300 text-honey-700">通过 · 未注明版本</span>
}

function EvidenceText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"'()]+)/gi)
  return (
    <span className="break-all">
      {parts.map((part, i) => {
        if (i % 2 === 0) return part
        const trailing = part.match(/[，。；：！？、,.!?;:]+$/)?.[0] || ''
        const url = trailing ? part.slice(0, -trailing.length) : part
        return (
          <span key={i}>
            <a href={url} target="_blank" rel="noreferrer" className="text-leaf-700 underline underline-offset-2 break-all">{url}</a>
            {trailing}
          </span>
        )
      })}
    </span>
  )
}

function AcceptanceBadge({ event }: { event: ProjectEvent }) {
  if (!event.acceptance) return <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] bg-slate-100 border border-slate-300 text-slate-600">验收未记录</span>
  return event.acceptance.status === 'accepted'
    ? <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] bg-leaf-100 border border-leaf-300 text-leaf-800">用户已验收</span>
    : <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] bg-red-50 border-red-200 text-red-600">用户未通过</span>
}

function ChangeSyncBadge({ sync }: { sync: ProjectEvent['changes'][number]['sync'] }) {
  const label = sync === 'updated' ? '已写入' : sync === 'pending' ? '待写入' : '推断影响'
  const style = sync === 'updated'
    ? 'bg-leaf-50 border-leaf-200 text-leaf-800'
    : sync === 'pending'
      ? 'bg-slate-100 border-slate-300 text-slate-600'
      : 'bg-honey-100 border-honey-300 text-honey-700'
  return <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[10px] border ${style}`}>{label}</span>
}

function PendingBadge({ label }: { label: '未验证' | '待写入' | '推断影响' | '待复验' }) {
  const style = label === '未验证' || label === '待写入'
    ? 'bg-slate-100 border-slate-300 text-slate-600'
    : 'bg-honey-100 border-honey-300 text-honey-700'
  return <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[10px] border ${style}`}>{label}</span>
}

function isCommandLike(item: string): boolean {
  return /^\s*(?:npm|npx|node|pnpm|yarn|bun|curl|git|deno|tsx|python3?|pytest|go|cargo|make|bash|sh|powershell)\b/i.test(item)
    || /\b(?:run|test:)[^\s]*/i.test(item)
}

function firstHttpUrl(text?: string): string | null {
  const match = text?.match(/https?:\/\/[^\s<>"'()]+/i)?.[0]
  if (!match) return null
  const trailing = match.match(/[，。；：！？、,.!?;:]+$/)?.[0] || ''
  return trailing ? match.slice(0, -trailing.length) : match
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mt-3">
      <h4 className="text-xs font-semibold text-leaf-700">{title}{hint && <span className="ml-2 font-normal text-leaf-700/60">{hint}</span>}</h4>
      <div className="mt-1">{children}</div>
    </section>
  )
}

function TechSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <h5 className="text-xs font-semibold text-leaf-700">{title}{hint && <span className="ml-2 font-normal text-leaf-700/60">{hint}</span>}</h5>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

function EventDetail({ event, onBack, onAccept, concepts, onOpenConcept, chatEnabled }: {
  event: ProjectEvent
  onBack: () => void
  onAccept: Props['onAccept']
  concepts: Concept[]
  onOpenConcept: (id: string) => void
  chatEnabled: boolean
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [explainOpen, setExplainOpen] = useState(false)
  const explainRef = useRef<HTMLDetailsElement>(null)
  // 通用关联规则：学习点应用的 output_ref 指向本事件即命中，不按事件 id/标题特判。
  const explanations = concepts.flatMap((concept) =>
    concept.applications
      .filter((a) => a.output_ref === `event:${event.id}`)
      .map((application) => ({ concept, application }))
  )
  const openExplain = () => {
    setExplainOpen(true)
    requestAnimationFrame(() => explainRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  }
  const verifiedItems = event.verifications.filter((v) => v.status === 'verified')
  const staleVerified = event.verifications.filter((v) => v.status === 'verified' && verificationFreshness(v, event) === 'stale')
  const outcome = event.outcome?.trim()
  const firstDecision = event.decisions[0]?.decision.trim()
  const firstChangeSummary = event.changes[0]?.summary.trim()
  const changeSummary = outcome || firstDecision || firstChangeSummary
  const nextItems = [
    ...event.verifications.filter((v) => v.status === 'unverified').map((v, i) => ({
      key: `verification-${i}`,
      label: '未验证' as const,
      text: v.scope?.trim() || v.item,
    })),
    ...event.changes.filter((c) => c.sync !== 'updated').map((c, i) => ({
      key: `change-${i}`,
      label: c.sync === 'pending' ? '待写入' as const : '推断影响' as const,
      text: `${c.target}：${c.summary}`,
    })),
    ...staleVerified.map((v, i) => ({
      key: `stale-${i}`,
      label: '待复验' as const,
      text: v.scope?.trim() || v.item,
    })),
  ]

  const runAccept = async (decision: 'accepted' | 'rejected') => {
    if (busy) return
    setBusy(true)
    try { await onAccept(event, decision, note) } finally { setBusy(false) }
  }

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-3">
      <button onClick={onBack} className="text-xs text-leaf-700 hover:text-leaf-800 underline underline-offset-2">← 返回列表</button>
      <div className="mt-1.5 flex items-start justify-between gap-3">
        <h3 className="font-display text-base font-semibold leading-snug text-ink">{event.task_title}</h3>
        <AcceptanceBadge event={event} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-leaf-700/70">
        <span className="px-1.5 py-0.5 rounded-full border border-leaf-200 bg-white/70">{event.project_id}</span>
        <span>{fmtTime(event.received_at)}</span>
      </div>

      {changeSummary && (
        <Section title="这轮改了什么">
          <p className="text-sm leading-snug text-ink">{changeSummary}</p>
          {event.changes.length > 0 && <p className="mt-0.5 text-[11px] text-leaf-700/60">共 {event.changes.length} 处改动{outcome || firstDecision ? '，明细见技术细节' : ''}</p>}
        </Section>
      )}

      {verifiedItems.length > 0 && (
        <Section title="实际验证了什么" hint="只展示有证据的验证记录">
          <ul className="divide-y divide-leaf-100">
            {verifiedItems.map((v, i) => {
              const url = firstHttpUrl(v.evidence)
              const simulated = /mock|模拟|假库/i.test(`${v.scope || ''} ${v.evidence || ''}`)
              const label = v.scope?.trim() || (isCommandLike(v.item) ? '' : v.item)
              return (
                <li key={i} className="py-1.5 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-2">
                    {label && <span className="min-w-0 flex-1 truncate text-xs font-medium leading-snug text-ink" title={label}>{label}</span>}
                    <div className="flex shrink-0 items-center gap-1 ml-auto">
                      {simulated && <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-100 border border-slate-300 text-slate-600">模拟验证</span>}
                      <VerificationBadge v={v} event={event} />
                    </div>
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] leading-snug text-leaf-700/60">
                    {v.environment && <span className="min-w-0 flex-1 truncate" title={v.environment}>环境：{v.environment}</span>}
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer" title={url} className="shrink-0 text-leaf-700 underline underline-offset-2">查看证据外链</a>
                    ) : <span className="shrink-0">来源：执行摘要（Agent 记录）</span>}
                  </div>
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      {(nextItems.length > 0 || event.risks.length > 0 || explanations.length > 0) && (
        <Section title="还有什么没查">
          {nextItems.length > 0 && (
            <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {nextItems.map((item) => (
                <li key={item.key} className="flex min-w-0 items-baseline gap-1">
                  <PendingBadge label={item.label} />
                  <span className="text-xs leading-snug text-ink break-all" title={item.text}>{truncate(item.text, 72)}</span>
                </li>
              ))}
            </ul>
          )}
          {event.risks.length > 0 && <p className="mt-1 text-[11px] leading-snug text-honey-700">另有 {event.risks.length} 项风险/未知，见技术细节</p>}
          {explanations.length > 0 && (
            <button type="button" aria-expanded={explainOpen} onClick={openExplain} className="mt-1 text-xs font-medium text-leaf-700 underline underline-offset-2">为什么证据只到这里？</button>
          )}
        </Section>
      )}

      {chatEnabled && <EventChat key={event.id} eventId={event.id} />}

      <Section title="用户验收" hint="只能由你本人记录，Agent 不代记">
        {event.acceptance ? (
          <div className="text-sm bg-white/70 border border-leaf-100 rounded-xl px-3 py-2">
            <AcceptanceBadge event={event} />
            <span className="ml-2 text-[11px] text-leaf-700/70">{fmtTime(event.acceptance.at)}</span>
            {event.acceptance.note && <p className="mt-1 text-ink">{event.acceptance.note}</p>}
          </div>
        ) : (
          <div className="bg-white/70 border border-leaf-100 rounded-xl px-3 py-2">
            <div className="flex items-center gap-2"><AcceptanceBadge event={event} /><span className="text-[11px] text-leaf-700/60">亲自核对上面的改动与证据后再记录</span></div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="验收备注（可选）：你亲自检查了什么"
              className="mt-2 w-full text-sm rounded-xl border border-leaf-200 bg-white px-3 py-2 focus:outline-none focus:border-leaf-500" />
            <div className="mt-2 flex gap-2">
              <button onClick={() => void runAccept('accepted')} disabled={busy} className="px-4 py-1.5 text-sm rounded-full bg-leaf-600 text-white font-semibold hover:bg-leaf-700 disabled:opacity-40">验收通过</button>
              <button onClick={() => void runAccept('rejected')} disabled={busy} className="px-4 py-1.5 text-sm rounded-full border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40">不通过</button>
            </div>
          </div>
        )}
      </Section>

      {explanations.length > 0 && (
        <details ref={explainRef} open={explainOpen} onToggle={(e) => setExplainOpen(e.currentTarget.open)} className="mt-3 rounded-xl border border-leaf-200 bg-leaf-50/70">
          <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-leaf-800">理解这条记录背后的机制</summary>
          <div className="divide-y divide-leaf-200 px-3 pb-3">
            {explanations.map(({ concept, application }) => (
              <article key={concept.id} className="space-y-2 py-2 text-sm leading-relaxed text-ink">
                <h4 className="font-semibold">{concept.title}</h4>
                <p className="whitespace-pre-line">{application.evidence}</p>
                <p>{application.consequence}</p>
                <p className="rounded-lg bg-white/80 px-3 py-2">{application.verify_action}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-leaf-700">
                  {application.sources.filter((s) => /^https?:\/\//i.test(s.url)).map((source, i) => (
                    <a key={i} href={source.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">{source.title}</a>
                  ))}
                  <button type="button" onClick={() => onOpenConcept(concept.id)} className="underline underline-offset-2">在知识树中查看</button>
                </div>
              </article>
            ))}
          </div>
        </details>
      )}

      <details className="mt-3 bg-white/60 border border-leaf-100 rounded-xl">
        <summary className="cursor-pointer px-3 py-1.5 text-xs font-semibold text-leaf-700">技术细节</summary>
        <div className="px-3 pb-3 space-y-3">
          {event.changes.length > 0 && (
            <TechSection title="逐文件改动">
              <ul className="divide-y divide-leaf-100">
                {event.changes.map((c, i) => (
                  <li key={i} className="py-1.5 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono text-[11px] text-leaf-700/70 break-all">{c.target}</span>
                      <ChangeSyncBadge sync={c.sync} />
                    </div>
                    <p className="mt-0.5 text-xs leading-snug text-ink">{c.summary}</p>
                  </li>
                ))}
              </ul>
            </TechSection>
          )}

          {event.verifications.length > 0 && (
            <TechSection title="验证完整记录">
              <ul className="space-y-1.5">
                {event.verifications.map((v, i) => (
                  <li key={i} className="text-xs bg-white/70 border border-leaf-100 rounded-xl px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-ink break-all">{v.item}{isCommandLike(v.item) ? '（测试命令）' : ''}</span>
                      <VerificationBadge v={v} event={event} />
                    </div>
                    <div className="mt-1 space-y-0.5 text-leaf-700/70">
                      {v.environment && <div>环境：{v.environment}</div>}
                      {v.scope && <div>范围：{v.scope}</div>}
                      {v.revision && <div>执行版本：{v.revision}</div>}
                      {v.evidence && <div>证据原文：<EvidenceText text={v.evidence} /></div>}
                    </div>
                  </li>
                ))}
              </ul>
            </TechSection>
          )}

          {event.agent_report && (
            <TechSection title="完整 Agent 报告" hint="Agent 自报，不等于验证通过">
              <p className="text-xs text-ink whitespace-pre-wrap bg-white/70 border border-leaf-100 rounded-xl px-3 py-2">{event.agent_report}</p>
            </TechSection>
          )}

          <TechSection title="版本快照">
            <div className="text-xs bg-white/70 border border-leaf-100 rounded-xl px-3 py-2 font-mono break-all space-y-0.5">
              <div>type: {event.source_revision.type}</div>
              <div>ref: {event.source_revision.ref}</div>
              {event.source_revision.base && <div>base: {event.source_revision.base}</div>}
              {event.source_revision.diff_sha256 && <div>diff sha256: {event.source_revision.diff_sha256}</div>}
            </div>
          </TechSection>

          {event.decisions.length > 0 && (
            <TechSection title="决定及理由">
              <ul className="space-y-1.5">
                {event.decisions.map((d, i) => (
                  <li key={i} className="text-xs bg-white/70 border border-leaf-100 rounded-xl px-3 py-2">
                    <div className="text-ink">{d.decision}</div>
                    <div className="mt-0.5 text-[11px] text-leaf-700/70">理由：{d.reason}</div>
                  </li>
                ))}
              </ul>
            </TechSection>
          )}

          {event.risks.length > 0 && (
            <TechSection title="风险与未知">
              <ul className="space-y-1.5">
                {event.risks.map((r, i) => (
                  <li key={i} className="text-xs bg-white/70 border border-leaf-100 rounded-xl px-3 py-2">
                    <div className="text-ink">{r.text}</div>
                    <div className="mt-0.5 text-[11px] text-leaf-700/70">类型：{r.kind === 'risk' ? '风险' : '未知'}</div>
                  </li>
                ))}
              </ul>
            </TechSection>
          )}

          {event.learning_candidates.length > 0 && (
            <TechSection title="学习候选">
              <ul className="list-disc pl-5 text-xs text-ink">
                {event.learning_candidates.map((l, i) => <li key={i}>{l.title}{l.note && <span className="text-[11px] text-leaf-700/70">（{l.note}）</span>}</li>)}
              </ul>
            </TechSection>
          )}

          <TechSection title="Workspace 同步状态">
            <div className="text-xs bg-leaf-50 border border-leaf-200 rounded-xl px-3 py-2 text-leaf-800">
              <div>已接收并保存 · 接收时间 {fmtTime(event.received_at)}（服务器盖章）</div>
              <div className="mt-0.5">任务 {event.task_id} · 轮次 {event.run_id}</div>
              <div className="mt-0.5 font-mono break-all">事件 ID：{event.id}</div>
            </div>
          </TechSection>
        </div>
      </details>
    </div>
  )
}

export function ProjectUpdates({ events, initialEventId, onBackFromEvent, loading, error, onClearError, onRefresh, onAccept, projects, onOpenConcept, chatEnabled }: Props) {
  const [activeId, setActiveId] = useState(initialEventId)
  const active = events.find((e) => e.id === activeId) || null

  return (
    <div className="h-full flex flex-col">
      {error && (
        <div className="shrink-0 px-4 sm:px-6 py-2 border-b bg-red-50 border-red-200 text-red-600 text-sm flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={onClearError} aria-label="关闭错误提示" className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
        </div>
      )}
      {active ? (
        <EventDetail key={active.id} event={active} onBack={() => { onBackFromEvent(); setActiveId(null) }} onAccept={onAccept}
          concepts={projects[active.project_id]?.concepts ?? []}
          onOpenConcept={(id) => onOpenConcept(active.project_id, id)} chatEnabled={chatEnabled} />
      ) : (
        <div className="h-full overflow-y-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-leaf-700/70">你的 Agent 完成任务后，把改动、证据和待查项提交到这里。先看这轮结果，再按需展开技术细节。</p>
            <button onClick={onRefresh} className="shrink-0 px-3 py-1.5 text-xs rounded-full border border-leaf-200 bg-white/80 text-leaf-700 hover:bg-leaf-50">刷新</button>
          </div>
          {loading ? (
            <div className="h-40 flex items-center justify-center text-sm text-leaf-700/70">正在读取项目更新…</div>
          ) : events.length === 0 ? (
            <div className="h-60 flex flex-col items-center justify-center text-center">
              <div className="text-4xl mb-3">📋</div>
              <h3 className="font-display text-lg font-semibold text-ink mb-1">还没有项目更新</h3>
              <p className="text-sm text-leaf-700/70 max-w-sm">让你的 Agent 完成一个任务后，按 project-wrapup Skill 收尾提交；这里会显示改了什么、验证了什么、还有什么没查。</p>
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {events.map((e) => {
                const verified = e.verifications.filter((v) => v.status === 'verified').length
                const unverified = e.verifications.length - verified
                const firstChange = e.changes[0]
                const pendingItem = cardPendingItem(e)
                return (
                  <li key={e.id}>
                    <button onClick={() => setActiveId(e.id)} className="w-full text-left bg-white/80 border border-leaf-100 rounded-2xl px-4 py-3 shadow-card hover:border-leaf-300 transition-colors">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-ink text-sm">{e.task_title}</span>
                        <AcceptanceBadge event={e} />
                      </div>
                      {firstChange && (
                        <div className="mt-1.5 text-sm text-ink">
                          <span className="font-medium">这一轮改了什么：</span>{truncate(firstChange.summary, 60)}{e.changes.length > 1 ? ` 等 ${e.changes.length} 处改动` : ''}
                        </div>
                      )}
                      {pendingItem && <div className="mt-1 text-xs text-honey-700"><span className="font-medium">待查：</span>{truncate(pendingItem, 100)}</div>}
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-leaf-700/70">
                        <span>{e.project_id}</span>
                        <span>{fmtTime(e.received_at)}</span>
                        <span className="px-2 py-0.5 rounded-full bg-leaf-50 border border-leaf-200 text-leaf-800">实测 {verified}</span>
                        <span className="px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-slate-600">未验证 {unverified}</span>
                        <span>{e.source_revision.type === 'git-commit' ? 'Git 提交' : '工作区快照'}</span>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
