import { useState } from 'react'
import { motion } from 'framer-motion'
import type { Concept, MarkStatus } from '../types'
import { isHttpUrl } from '../types'

interface NodeDetailProps {
  concept: Concept | null
  markStatus: MarkStatus | undefined
  onClose: () => void
  onMark: (id: string, status: MarkStatus) => void
  onVerify: (id: string, text: string) => void
  onDelete: (id: string) => void
}

const kindLabel = { concept: '概念', operation: '操作', fact: '事实' }
const kindColor = {
  concept: 'bg-blue-100 text-blue-700 border-blue-200',
  operation: 'bg-violet-100 text-violet-700 border-violet-200',
  fact: 'bg-teal-100 text-teal-700 border-teal-200',
}

const item = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }

export function NodeDetail({ concept, markStatus, onClose, onMark, onVerify, onDelete }: NodeDetailProps) {
  const [verifyText, setVerifyText] = useState('')

  if (!concept) {
    return (
      <div className="h-full flex items-center justify-center text-leaf-700/60 text-sm p-6">
        点击树上的果实查看知识详情
      </div>
    )
  }

  const latest = concept.applications[concept.applications.length - 1]
  const verifications = concept.verifications || []

  const submitVerify = () => {
    const t = verifyText.trim()
    if (!t) return
    onVerify(concept.id, t)
    setVerifyText('')
  }

  return (
    <motion.div
      className="panel-scroll h-full overflow-y-auto p-5 space-y-5 bg-cream"
      initial="hidden"
      animate="visible"
      variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}
    >
      <motion.div variants={item} className="flex items-start justify-between">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-ink leading-snug">{concept.title}</h2>
          <div className="flex items-center gap-2 mt-2">
            <span className={`text-xs px-2 py-0.5 rounded-full border ${kindColor[concept.kind]}`}>{kindLabel[concept.kind]}</span>
            <span className="text-xs text-leaf-700/70">{concept.branch}</span>
          </div>
        </div>
        <button onClick={onClose} aria-label="关闭详情" className="text-leaf-700/50 hover:text-ink text-2xl leading-none ml-2 rounded-full w-8 h-8 flex items-center justify-center hover:bg-leaf-100">×</button>
      </motion.div>

      {latest && (
        <>
          <motion.section variants={item} className="space-y-3 rounded-2xl bg-white/70 border border-leaf-100 p-4 shadow-card">
            <div>
              <h3 className="text-xs font-semibold text-leaf-700/70 mb-1">判断什么</h3>
              <p className="text-sm text-honey-600 leading-relaxed">{latest.judging}</p>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-leaf-700/70 mb-1">依据是什么</h3>
              <p className="text-sm text-ink/80 leading-relaxed">{latest.evidence}</p>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-leaf-700/70 mb-1">不掌握会怎样</h3>
              <p className="text-sm text-ink/60 leading-relaxed">{latest.consequence}</p>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-leaf-700/70 mb-1">怎么验证掌握了</h3>
              <p className="text-sm text-leaf-700 leading-relaxed">{latest.verify_action}</p>
            </div>
          </motion.section>

          {latest.sources.length > 0 && (
            <motion.section variants={item}>
              <h3 className="text-xs font-semibold text-leaf-700/70 mb-2">来源</h3>
              <ul className="space-y-1.5">
                {latest.sources.map((s, i) =>
                  isHttpUrl(s.url) ? (
                    <li key={i}>
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:text-blue-500 underline decoration-blue-200 underline-offset-2">
                        {s.title}
                      </a>
                    </li>
                  ) : (
                    <li key={i} className="text-sm text-ink/50">{s.title}（链接无效）</li>
                  )
                )}
              </ul>
            </motion.section>
          )}
        </>
      )}

      {/* 验收记录：产品核心动作 */}
      <motion.section variants={item} className="rounded-2xl bg-leaf-50 border border-leaf-200 p-4">
        <h3 className="text-sm font-display font-semibold text-leaf-800 mb-1">我用它检查了什么</h3>
        <p className="text-xs text-leaf-700/70 mb-3">把一次真实的验收动作记下来，这条知识才算真正长在你身上。</p>
        {verifications.length > 0 && (
          <ul className="space-y-2 mb-3">
            {verifications.map((v) => (
              <li key={v.id} className="text-sm text-ink/80 bg-white/80 rounded-xl px-3 py-2 border border-leaf-100">
                <p className="leading-relaxed">{v.text}</p>
                <span className="text-[10px] text-leaf-700/50">{v.created_at.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        )}
        <textarea
          value={verifyText}
          onChange={(e) => setVerifyText(e.target.value)}
          rows={2}
          placeholder="例如：用隐身窗口打开公网链接，确认未登录也能访问…"
          aria-label="记录一次验收动作"
          className="w-full text-sm rounded-xl border border-leaf-200 bg-white px-3 py-2 text-ink placeholder:text-leaf-700/40 focus:border-leaf-500 focus:outline-none resize-none"
        />
        <button
          onClick={submitVerify}
          disabled={!verifyText.trim()}
          className="mt-2 px-3 py-1.5 text-sm rounded-full bg-leaf-600 text-white font-semibold hover:bg-leaf-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          保存验收记录
        </button>
      </motion.section>

      {concept.applications.length > 1 && (
        <motion.section variants={item}>
          <h3 className="text-xs font-semibold text-leaf-700/70 mb-2">应用记录（{concept.applications.length}）</h3>
          <ul className="space-y-2">
            {concept.applications.map((app, i) => (
              <li key={i} className="border-l-2 border-leaf-300 pl-3">
                <p className="text-xs text-ink/80">{app.judging}</p>
                <span className="text-[10px] text-leaf-700/50">{app.output_ref} · {app.created_at.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </motion.section>
      )}

      <motion.div variants={item} className="flex items-center gap-2 pt-3 border-t border-leaf-100">
        <button
          onClick={() => onMark(concept.id, 'understood')}
          className={`px-3 py-1.5 text-sm rounded-full border font-semibold transition-colors ${
            markStatus === 'understood' ? 'bg-honey-400 text-white border-honey-500' : 'bg-honey-100 text-honey-600 border-honey-300 hover:bg-honey-300/60'
          }`}
        >
          我理解了
        </button>
        <button
          onClick={() => onMark(concept.id, 'skipped')}
          className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
            markStatus === 'skipped' ? 'bg-slate-500 text-white border-slate-500' : 'bg-white text-ink/60 border-leaf-200 hover:bg-leaf-50'
          }`}
        >
          暂时跳过
        </button>
        <button
          onClick={() => onDelete(concept.id)}
          aria-label="删除这条知识"
          className="ml-auto px-3 py-1.5 text-sm rounded-full border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
        >
          删除
        </button>
      </motion.div>
    </motion.div>
  )
}
