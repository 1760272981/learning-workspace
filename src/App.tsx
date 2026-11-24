import { useState, useMemo, useCallback, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { KnowledgeTree } from './components/KnowledgeTree'
import { NodeDetail } from './components/NodeDetail'
import { AddKnowledgeModal } from './components/AddKnowledgeModal'
import { LandingPage } from './components/LandingPage'
import { TokenPanel } from './components/TokenPanel'
import { ToastStack, type ToastItem } from './components/Toast'
import { useKnowledgeStore } from './hooks/useKnowledgeStore'
import type { MarkStatus, SubmitInput, SubmitResult, Concept } from './types'

type SortKey = 'default' | 'newest' | 'branch' | 'title'
type StatusFilter = 'all' | 'understood' | 'skipped' | 'unmarked'

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const handler = () => setMatches(mq.matches)
    handler()
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [query])
  return matches
}

const latestText = (c: Concept) => {
  const a = c.applications[c.applications.length - 1]
  return a ? `${a.judging} ${a.evidence} ${a.consequence} ${a.verify_action}` : ''
}

export default function App() {
  const {
    store, projectIds, projectId, setProjectId, concepts, projectName,
    marks, mark, addConcept, addVerification, deleteConcept, loading, error, setError, usingCache,
    user, mode, authLoading, login, register, logout,
  } = useKnowledgeStore()

  const [activeId, setActiveId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [branchFilter, setBranchFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<SortKey>('default')
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [tokenPanelOpen, setTokenPanelOpen] = useState(false)
  const [logoutBusy, setLogoutBusy] = useState(false)
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  const dismissToast = useCallback((id: string) => setToasts((p) => p.filter((t) => t.id !== id)), [])
  const pushToast = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    setToasts((p) => [...p.slice(-2), { ...t, id }])
  }, [])

  const branches = useMemo(() => Array.from(new Set(concepts.map((c) => c.branch))), [concepts])
  const activeConcept = concepts.find((c) => c.id === activeId) || null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = concepts.filter((c) => {
      if (branchFilter !== 'all' && c.branch !== branchFilter) return false
      const st = marks[c.id]
      if (statusFilter === 'understood' && st !== 'understood') return false
      if (statusFilter === 'skipped' && st !== 'skipped') return false
      if (statusFilter === 'unmarked' && st) return false
      if (q && !(`${c.title} ${c.branch} ${latestText(c)}`.toLowerCase().includes(q))) return false
      return true
    })
    if (sort === 'newest') list = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at))
    else if (sort === 'branch') list = [...list].sort((a, b) => a.branch.localeCompare(b.branch, 'zh') || a.created_at.localeCompare(b.created_at))
    else if (sort === 'title') list = [...list].sort((a, b) => a.title.localeCompare(b.title, 'zh'))
    return list
  }, [concepts, marks, query, branchFilter, statusFilter, sort])

  const stats = useMemo(() => {
    const understood = concepts.filter((c) => marks[c.id] === 'understood').length
    const verified = concepts.filter((c) => (c.verifications || []).length > 0).length
    return { total: concepts.length, understood, verified }
  }, [concepts, marks])

  const filtersActive = query.trim() !== '' || branchFilter !== 'all' || statusFilter !== 'all'
  const clearFilters = () => { setQuery(''); setBranchFilter('all'); setStatusFilter('all') }

  const handleAdd = useCallback(async (input: SubmitInput): Promise<SubmitResult> => {
    const result = await addConcept(input)
    if (result.status === 'accepted' || result.status === 'linked') {
      setModalOpen(false)
      if (result.node_id) setActiveId(result.node_id)
      pushToast({
        kind: result.status === 'accepted' ? 'success' : 'info',
        message: result.status === 'accepted' ? `已入树：「${result.title}」` : `已关联到既有概念「${result.title}」，新增一条应用记录`,
      })
    }
    return result
  }, [addConcept, pushToast])

  const handleVerify = useCallback(async (id: string, text: string) => {
    const ok = await addVerification(id, text)
    if (ok) pushToast({ kind: 'success', message: '已记录一次真实验收，这条知识更长在你身上了' })
    return ok
  }, [addVerification, pushToast])

  const handleMark = useCallback(async (id: string, status: MarkStatus) => mark(id, status), [mark])

  const handleDelete = useCallback(async (id: string) => {
    const ok = await deleteConcept(id)
    if (!ok) return false
    if (activeId === id) setActiveId(null)
    pushToast({ kind: 'warning', message: mode === 'local' ? '已从本地删除这条知识' : '已从云端删除这条知识' })
    return true
  }, [deleteConcept, activeId, pushToast, mode])

  useEffect(() => {
    setActiveId(null)
    setModalOpen(false)
    setTokenPanelOpen(false)
    setQuery('')
    setBranchFilter('all')
    setStatusFilter('all')
    setSort('default')
  }, [user?.id])

  const handleLogout = useCallback(async () => {
    if (logoutBusy) return
    setLogoutBusy(true)
    try {
      await logout()
    } catch (cause) {
      pushToast({ kind: 'error', message: cause instanceof Error ? cause.message : '退出结果未确认，请稍后重试。' })
    } finally {
      setLogoutBusy(false)
    }
  }, [logout, logoutBusy, pushToast])

  const projectLabel = (id: string) => store.projects[id]?.name || id

  const selectCls = 'text-sm rounded-full border border-leaf-200 bg-white/80 px-3 py-1.5 text-ink focus:outline-none focus:border-leaf-500 cursor-pointer'

  const detail = activeConcept && (
    <NodeDetail
      concept={activeConcept}
      markStatus={marks[activeConcept.id]}
      onClose={() => setActiveId(null)}
      onMark={handleMark}
      onVerify={handleVerify}
      onDelete={handleDelete}
    />
  )

  const brand = (
    <div className="flex items-center gap-3 min-w-0">
      <span className="shrink-0 w-9 h-9 rounded-2xl bg-gradient-to-br from-leaf-400 to-leaf-600 flex items-center justify-center shadow-card">
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 21V11M12 11C12 7 9 4 4 4c0 5 3 8 8 7zM12 13c0-3 3-6 8-6c0 4-3 7-8 6z" />
        </svg>
      </span>
      <div className="min-w-0">
        <h1 className="font-display text-base sm:text-lg font-semibold leading-tight truncate">Learning Workspace</h1>
        <p className="hidden sm:block text-[11px] text-leaf-700/70 leading-tight">Build with AI. Grow beyond AI. · 以判断与验收为中心</p>
      </div>
    </div>
  )

  if (authLoading) {
    return (
      <div className="h-screen flex flex-col garden-bg text-ink">
        <header className="shrink-0 border-b border-leaf-100 bg-cream/80 px-4 sm:px-6 py-3">{brand}</header>
        <div className="flex flex-1 items-center justify-center text-sm text-leaf-700/70">正在检查登录状态…</div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="h-screen flex flex-col garden-bg text-ink">
        <header className="shrink-0 border-b border-leaf-100 bg-cream/80 px-4 sm:px-6 py-3">{brand}</header>
        <LandingPage error={error} onClearError={() => setError(null)} onLogin={login} onRegister={register} />
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col garden-bg text-ink">
      {/* 顶栏 */}
      <header className="relative shrink-0 z-30 flex items-center justify-between gap-3 px-4 sm:px-6 py-3 bg-cream/80 backdrop-blur border-b border-leaf-100">
        <div className="flex items-center gap-3 min-w-0">
          <span className="shrink-0 w-9 h-9 rounded-2xl bg-gradient-to-br from-leaf-400 to-leaf-600 flex items-center justify-center shadow-card">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21V11M12 11C12 7 9 4 4 4c0 5 3 8 8 7zM12 13c0-3 3-6 8-6 0 4-3 7-8 6z" />
            </svg>
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-base sm:text-lg font-semibold leading-tight truncate">Learning Workspace</h1>
            <p className="hidden sm:block text-[11px] text-leaf-700/70 leading-tight">Build with AI. Grow beyond AI. · 以判断与验收为中心</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {projectIds.length > 0 && (
            <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setActiveId(null) }} aria-label="切换项目" className={`${selectCls} hidden sm:block max-w-[160px]`}>
              {projectIds.map((id) => <option key={id} value={id}>{projectLabel(id)}</option>)}
            </select>
          )}
          {mode === 'local' && <span className="hidden md:block rounded-full border border-leaf-200 bg-leaf-50 px-3 py-1.5 text-xs text-leaf-700">本地模式 · 无需登录</span>}
          {mode === 'cloud' && (
            <>
              <span className="hidden md:block max-w-[120px] truncate text-xs text-leaf-700/70" title={user.username}>{user.username}</span>
              <button onClick={() => setTokenPanelOpen(true)} aria-expanded={tokenPanelOpen} className="px-3 py-2 text-xs rounded-full border border-leaf-200 bg-white/80 text-leaf-700 font-semibold hover:bg-leaf-50">
                我的令牌
              </button>
              <button onClick={() => void handleLogout()} disabled={logoutBusy} className="px-3 py-2 text-xs rounded-full border border-leaf-200 text-leaf-700/70 hover:bg-leaf-50 disabled:opacity-40">
                {logoutBusy ? '退出中…' : '退出'}
              </button>
            </>
          )}
          <button onClick={() => setModalOpen(true)} className="flex items-center gap-1.5 px-3 sm:px-4 py-2 text-sm rounded-full bg-leaf-600 text-white font-semibold hover:bg-leaf-700 shadow-card transition-colors">
            <span className="text-base leading-none">＋</span><span>记录知识</span>
          </button>
        </div>
      </header>

      {/* 工具栏：搜索 / 筛选 / 排序 / 统计 */}
      <div className="shrink-0 z-20 px-4 sm:px-6 py-2.5 bg-cream/55 backdrop-blur border-b border-leaf-100 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <svg viewBox="0 0 24 24" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-leaf-700/40" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题 / 分支 / 判断…" aria-label="搜索知识"
            className="w-full text-sm rounded-full border border-leaf-200 bg-white/80 pl-9 pr-3 py-1.5 text-ink placeholder:text-leaf-700/35 focus:outline-none focus:border-leaf-500" />
        </div>
        <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} aria-label="按分支筛选" className={selectCls}>
          <option value="all">全部分支</option>
          {branches.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} aria-label="按状态筛选" className={selectCls}>
          <option value="all">全部状态</option>
          <option value="understood">已理解</option>
          <option value="skipped">已跳过</option>
          <option value="unmarked">未标记</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="排序方式" className={selectCls}>
          <option value="default">入树顺序</option>
          <option value="newest">最新优先</option>
          <option value="branch">按分支</option>
          <option value="title">按标题</option>
        </select>
        {filtersActive && (
          <button onClick={clearFilters} className="text-xs text-leaf-700 hover:text-leaf-800 underline underline-offset-2 decoration-leaf-300">清除筛选</button>
        )}
        <div className="ml-auto flex items-center gap-1.5 text-[11px]">
          <span className="px-2 py-1 rounded-full bg-white/70 border border-leaf-100 text-leaf-800">共 <b>{stats.total}</b></span>
          <span className="px-2 py-1 rounded-full bg-honey-100 border border-honey-300 text-honey-600">理解 <b>{stats.understood}</b></span>
          <span className="px-2 py-1 rounded-full bg-leaf-100 border border-leaf-200 text-leaf-800">验收 <b>{stats.verified}</b></span>
        </div>
      </div>

      {error && (
        <div className={`shrink-0 px-4 sm:px-6 py-2 border-b text-sm flex items-center justify-between gap-3 ${usingCache ? 'bg-honey-50 border-honey-200 text-honey-700' : 'bg-red-50 border-red-200 text-red-600'}`}>
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="关闭错误提示" className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
        </div>
      )}

      {/* 主区域 */}
      <div className="flex-1 min-h-0 flex relative">
        <div className="flex-1 min-w-0 relative">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-leaf-700/70">
              <span className="w-10 h-10 rounded-full border-4 border-leaf-200 border-t-leaf-600 animate-spin" />
              <p className="text-sm">正在加载你的知识树…</p>
            </div>
          ) : concepts.length === 0 ? (
            <div className="h-full flex items-center justify-center p-6">
              <div className="text-center max-w-sm animate-riseIn">
                <div className="text-5xl mb-3">🌱</div>
                <h2 className="font-display text-xl font-semibold text-ink mb-2">还没有学习点</h2>
                <p className="text-sm text-leaf-700/70 mb-5">还没有学习点，用 MCP 提交或手动添加。把一次 AI 产出用三问拆解，记下你的判断与验收。</p>
                <button onClick={() => setModalOpen(true)} className="px-5 py-2.5 rounded-full bg-leaf-600 text-white font-semibold hover:bg-leaf-700 shadow-card">记录第一条知识</button>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="h-full flex items-center justify-center p-6">
              <div className="text-center max-w-sm">
                <div className="text-4xl mb-3">🍃</div>
                <h2 className="font-display text-lg font-semibold text-ink mb-2">没有匹配的知识</h2>
                <p className="text-sm text-leaf-700/70 mb-4">换个关键词，或清除筛选条件再看看。</p>
                <button onClick={clearFilters} className="px-4 py-2 rounded-full border border-leaf-300 text-leaf-800 font-semibold hover:bg-leaf-50">清除筛选</button>
              </div>
            </div>
          ) : (
            <>
              <KnowledgeTree concepts={filtered} marks={marks} activeId={activeId} onNodeClick={setActiveId} />
              <div className="hidden md:flex absolute top-3 left-3 flex-col gap-1 text-[10px] text-leaf-800/70 bg-white/55 backdrop-blur rounded-xl px-2.5 py-2 pointer-events-none border border-leaf-100">
                <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-blue-500" />概念</span>
                <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-violet-500" />操作</span>
                <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-teal-500" />事实</span>
                <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-honey-500" />已理解</span>
                <span className="mt-1 pt-1 border-t border-leaf-100 text-leaf-800/60">上下滚动 · 点击果实查看</span>
              </div>
            </>
          )}
        </div>

        {/* 桌面：右侧抽屉 */}
        <AnimatePresence>
          {isDesktop && activeConcept && (
            <motion.aside
              key="drawer"
              initial={{ x: 400, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 400, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 240 }}
              className="w-[380px] shrink-0 border-l border-leaf-100 bg-cream shadow-pop z-10"
            >
              {detail}
            </motion.aside>
          )}
        </AnimatePresence>

        {/* 移动：底部抽屉 */}
        <AnimatePresence>
          {!isDesktop && activeConcept && (
            <>
              <motion.div key="scrim" className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setActiveId(null)} />
              <motion.div
                key="sheet"
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 30, stiffness: 260 }}
                className="fixed inset-x-0 bottom-0 z-50 max-h-[76vh] rounded-t-3xl bg-cream shadow-pop border-t border-leaf-100 overflow-hidden flex flex-col"
              >
                <div className="shrink-0 pt-2 flex justify-center"><span className="w-10 h-1.5 rounded-full bg-leaf-200" /></div>
                <div className="flex-1 min-h-0 overflow-hidden">{detail}</div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {modalOpen && (
          <AddKnowledgeModal
            key="modal"
            projectId={projectId}
            projectName={projectName}
            branches={branches}
            onClose={() => setModalOpen(false)}
            onSubmit={handleAdd}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {mode === 'cloud' && tokenPanelOpen && (
          <TokenPanel
            key={`tokens-${user.id}`}
            user={user}
            onClose={() => setTokenPanelOpen(false)}
            onNotify={(message, kind = 'info') => pushToast({ kind, message })}
          />
        )}
      </AnimatePresence>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}