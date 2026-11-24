import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { Kind, SubmitInput, SubmitResult } from '../types'
import { validateSubmit, isHttpUrl } from '../types'

interface Props {
  projectId: string
  projectName: string
  branches: string[]
  onClose: () => void
  onSubmit: (input: SubmitInput) => Promise<SubmitResult>
}

const FIELD_LABEL: Record<string, string> = {
  project: '项目',
  output_ref: '产出标识',
  title: '标题',
  kind: '类型',
  judging: '判断什么',
  evidence: '依据是什么',
  consequence: '不掌握会怎样',
  verify_action: '怎么验证掌握了',
  sources: '真实来源',
}

const KIND_OPTIONS: { value: Kind; label: string; hint: string }[] = [
  { value: 'concept', label: '概念', hint: '一个可迁移的判断原则' },
  { value: 'operation', label: '操作', hint: '一套可复用的做法步骤' },
  { value: 'fact', label: '事实', hint: '一个被验证过的具体结论' },
]

const emptySource = () => ({ title: '', url: '' })

export function AddKnowledgeModal({ projectId, projectName, branches, onClose, onSubmit }: Props) {
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<Kind>('concept')
  const [branch, setBranch] = useState('')
  const [outputRef, setOutputRef] = useState('')
  const [judging, setJudging] = useState('')
  const [evidence, setEvidence] = useState('')
  const [consequence, setConsequence] = useState('')
  const [verifyAction, setVerifyAction] = useState('')
  const [sources, setSources] = useState([emptySource()])
  const [result, setResult] = useState<SubmitResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [requestError, setRequestError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab' && dialogRef.current) {
        const nodes = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        const list = Array.from(nodes).filter((n) => !n.hasAttribute('disabled'))
        if (list.length === 0) return
        const first = list[0]
        const last = list[list.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const input: SubmitInput = useMemo(
    () => ({
      project: projectId,
      output_ref: outputRef.trim(),
      title: title.trim(),
      kind,
      branch: branch.trim(),
      judging: judging.trim(),
      evidence: evidence.trim(),
      consequence: consequence.trim(),
      verify_action: verifyAction.trim(),
      sources: sources.map((s) => ({ title: s.title.trim(), url: s.url.trim() })),
    }),
    [projectId, outputRef, title, kind, branch, judging, evidence, consequence, verifyAction, sources]
  )

  const missing = useMemo(() => new Set(validateSubmit(input)), [input])
  const showMissing = result?.status === 'missing_evidence'

  const handleSubmit = async () => {
    if (submitting) return
    setSubmitting(true)
    setRequestError(null)
    try {
      const r = await onSubmit(input)
      setResult(r)
    } catch (cause) {
      setRequestError(cause instanceof Error ? cause.message : '写入结果未知，请先读取对账，不要直接重发')
    } finally {
      setSubmitting(false)
    }
  }

  const setSource = (i: number, key: 'title' | 'url', value: string) => {
    setSources((prev) => prev.map((s, idx) => (idx === i ? { ...s, [key]: value } : s)))
  }

  const labelCls = 'block text-xs font-semibold text-leaf-700/80 mb-1'
  const fieldCls = (bad: boolean) =>
    `w-full text-sm rounded-xl border bg-white px-3 py-2 text-ink placeholder:text-leaf-700/35 focus:outline-none focus:border-leaf-500 transition-colors ${
      bad ? 'border-red-300' : 'border-leaf-200'
    }`

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-knowledge-title"
        initial={{ y: 40, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 30, opacity: 0, scale: 0.98 }}
        transition={{ type: 'spring', damping: 26, stiffness: 280 }}
        className="relative w-full sm:max-w-xl max-h-[92vh] sm:max-h-[88vh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-cream shadow-pop border border-leaf-100 overflow-hidden"
      >
        <div className="shrink-0 px-5 pt-5 pb-3 border-b border-leaf-100 bg-gradient-to-r from-leaf-50 to-cream">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="add-knowledge-title" className="font-display text-lg font-semibold text-ink">记录一条知识</h2>
              <p className="text-xs text-leaf-700/70 mt-0.5">
                入树到「{projectName}」 · 用三问把一次 AI 产出变成你自己的判断力
              </p>
            </div>
            <button onClick={onClose} aria-label="关闭" className="text-leaf-700/50 hover:text-ink text-2xl leading-none w-8 h-8 rounded-full hover:bg-leaf-100 flex items-center justify-center">×</button>
          </div>
        </div>

        <div className="panel-scroll flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="k-title">标题 <span className="text-red-400">*</span></label>
              <input id="k-title" ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：判断该不该提取共用组件" className={fieldCls(showMissing && missing.has('title'))} />
            </div>
            <div>
              <label className={labelCls} htmlFor="k-kind">类型</label>
              <select id="k-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)} className={fieldCls(false)}>
                {KIND_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label} · {k.hint}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="k-branch">分支（可选）</label>
              <input id="k-branch" value={branch} onChange={(e) => setBranch(e.target.value)} list="branch-list"
                placeholder="如：可维护性 / 发布与验收" className={fieldCls(false)} />
              <datalist id="branch-list">{branches.map((b) => <option key={b} value={b} />)}</datalist>
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="k-output">产出标识 <span className="text-red-400">*</span></label>
              <input id="k-output" value={outputRef} onChange={(e) => setOutputRef(e.target.value)}
                placeholder="这次 AI 产出的版本标识，如 blog-nav-v1" className={fieldCls(showMissing && missing.has('output_ref'))} />
              <p className="text-[11px] text-leaf-700/55 mt-1">同一产出最多高亮 2 条、每个项目每天最多新增 3 条，逼自己挑最值得判断的。</p>
            </div>
          </div>

          <div className="rounded-2xl border border-leaf-100 bg-white/60 p-3 space-y-3">
            <p className="text-xs font-display font-semibold text-leaf-800">三问 + 验证动作</p>
            {([
              ['judging', '判断什么', judging, setJudging, '这次要做的判断是什么？'],
              ['evidence', '依据是什么', evidence, setEvidence, '支持这个判断的真实证据 / 观察'],
              ['consequence', '不掌握会怎样', consequence, setConsequence, '判断错了会带来什么后果'],
              ['verify_action', '怎么验证掌握了', verifyAction, setVerifyAction, '用一个可执行的动作证明你真的会判断'],
            ] as const).map(([key, label, val, setter, ph]) => (
              <div key={key}>
                <label className={labelCls} htmlFor={`k-${key}`}>{label} <span className="text-red-400">*</span></label>
                <textarea id={`k-${key}`} value={val} onChange={(e) => setter(e.target.value)} rows={2}
                  placeholder={ph} className={`${fieldCls(showMissing && missing.has(key))} resize-none`} />
              </div>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={labelCls + ' mb-0'}>真实来源 <span className="text-red-400">*</span></label>
              <button onClick={() => setSources((p) => [...p, emptySource()])} className="text-xs font-semibold text-leaf-700 hover:text-leaf-800">＋ 添加来源</button>
            </div>
            <p className="text-[11px] text-leaf-700/55 mb-2">必须先真实搜索得到链接，禁止编造 URL；至少一条 http(s) 来源。</p>
            <div className="space-y-2">
              {sources.map((s, i) => (
                <div key={i} className="flex flex-col sm:flex-row gap-2">
                  <input value={s.title} onChange={(e) => setSource(i, 'title', e.target.value)} placeholder="来源标题"
                    aria-label={`来源 ${i + 1} 标题`} className={fieldCls(showMissing && missing.has('sources')) + ' sm:w-2/5'} />
                  <div className="flex-1 flex gap-2">
                    <input value={s.url} onChange={(e) => setSource(i, 'url', e.target.value)} placeholder="https://…"
                      aria-label={`来源 ${i + 1} 链接`} className={fieldCls((showMissing && missing.has('sources')) || (!!s.url && !isHttpUrl(s.url)))} />
                    {sources.length > 1 && (
                      <button onClick={() => setSources((p) => p.filter((_, idx) => idx !== i))} aria-label={`移除来源 ${i + 1}`}
                        className="shrink-0 w-9 rounded-xl border border-leaf-200 text-leaf-700/60 hover:text-red-500 hover:border-red-200">×</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {result && result.status !== 'accepted' && result.status !== 'linked' && (
            <div className={`rounded-2xl border p-3 text-sm ${result.status === 'over_limit' ? 'border-honey-300 bg-honey-100/60 text-honey-600' : 'border-red-200 bg-red-50 text-red-600'}`}>
              <p className="font-semibold mb-1">
                {result.status === 'over_limit'
                  ? `本轮收手：${result.scope === 'day' ? '今天' : '该产出'}已达上限（${result.limit} 条）`
                  : '还差一点，补齐后再入树'}
              </p>
              {result.missing && result.missing.length > 0 && (
                <p className="text-xs mb-1">缺少：{result.missing.map((m) => FIELD_LABEL[m] || m).join('、')}</p>
              )}
              <ul className="text-xs list-disc pl-4 space-y-0.5 opacity-90">
                {result.hints.map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            </div>
          )}
        </div>

        <div className="shrink-0 px-5 py-3 border-t border-leaf-100 bg-cream flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {requestError && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              {requestError}
            </div>
          )}
          <p className="text-[11px] text-leaf-700/55 hidden sm:block">
            {missing.size > 0 ? `还需补齐 ${missing.size} 项` : '三问与来源已就绪'}
          </p>
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-full border border-leaf-200 text-ink/70 hover:bg-leaf-50">取消</button>
            <button onClick={handleSubmit} disabled={submitting} className="px-5 py-2 text-sm rounded-full bg-leaf-600 text-white font-semibold hover:bg-leaf-700 shadow-card transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {submitting ? '正在写入…' : '提交入树'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}