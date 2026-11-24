import { useState, useEffect, useCallback, useRef } from 'react'
import type { Store, Concept, MarkStatus, SubmitInput, SubmitResult } from '../types'
import {
  CloudError,
  fetchSession,
  fetchStore,
  login as loginRequest,
  register as registerRequest,
  logout as logoutRequest,
  writeAction,
  type User,
} from '../api'

const DEFAULT_PROJECT_ID = 'learning-workspace'
const EMPTY_STORE: Store = { projects: {} }
const cacheKey = (userId: string, mode: 'local' | 'cloud') => mode === 'local' ? 'lw-store-v3:local' : `lw-store-v3:${userId}`

function readLocal(userId: string, mode: 'local' | 'cloud'): Store | null {
  try {
    const raw = localStorage.getItem(cacheKey(userId, mode))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Store
    return parsed && typeof parsed === 'object' && parsed.projects && typeof parsed.projects === 'object' ? parsed : null
  } catch {
    return null
  }
}

function writeLocal(userId: string, store: Store, mode: 'local' | 'cloud') {
  try {
    localStorage.setItem(cacheKey(userId, mode), JSON.stringify(store))
  } catch {
    // 缓存不可用时仍以云端读取结果为准。
  }
}

function removeLocal(userId: string, mode: 'local' | 'cloud') {
  try {
    localStorage.removeItem(cacheKey(userId, mode))
  } catch {
    // 登出仍以清除内存和服务端会话为准。
  }
}

export function useKnowledgeStore() {
  const [user, setUser] = useState<User | null>(null)
  const [mode, setMode] = useState<'local' | 'cloud'>('cloud')
  const [authLoading, setAuthLoading] = useState(true)
  const [store, setStore] = useState<Store>(EMPTY_STORE)
  const [projectId, setProjectId] = useState(DEFAULT_PROJECT_ID)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [usingCache, setUsingCache] = useState(false)
  const userRef = useRef<User | null>(null)
  const modeRef = useRef<'local' | 'cloud'>('cloud')
  const requestSeq = useRef(0)

  const acceptUser = useCallback((next: User | null, nextMode: 'local' | 'cloud' = 'cloud') => {
    requestSeq.current += 1
    userRef.current = next
    modeRef.current = nextMode
    setMode(nextMode)
    setUser(next)
    setError(null)
    if (!next) {
      setStore(EMPTY_STORE)
      setProjectId(DEFAULT_PROJECT_ID)
      setUsingCache(false)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    void fetchSession().then((session) => {
      if (!active) return
      if (session) acceptUser(session.user, session.mode)
    }).catch((cause) => {
      if (!active) return
      setError(cause instanceof CloudError ? cause.message : '登录状态检查失败，请刷新后重试')
    }).finally(() => {
      if (active) setAuthLoading(false)
    })
    return () => { active = false }
  }, [acceptUser])

  const refreshStore = useCallback(async () => {
    const current = userRef.current
    if (!current) return false
    const currentMode = modeRef.current
    const seq = ++requestSeq.current
    setLoading(true)
    try {
      const data = await fetchStore()
      if (seq !== requestSeq.current || userRef.current?.id !== current.id) return false
      setStore(data)
      writeLocal(current.id, data, currentMode)
      setUsingCache(false)
      setError(null)
      setProjectId((value) => data.projects[value] ? value : Object.keys(data.projects)[0] || DEFAULT_PROJECT_ID)
      return true
    } catch (cause) {
      if (seq !== requestSeq.current || userRef.current?.id !== current.id) return false
      if (currentMode === 'cloud' && cause instanceof CloudError && cause.status === 401) {
        removeLocal(current.id, currentMode)
        acceptUser(null)
        setError('登录状态已失效，请重新登录。')
        return false
      }
      const cached = readLocal(current.id, currentMode)
      setUsingCache(!!cached)
      setError(`${cause instanceof CloudError ? cause.message : '读取失败'}${cached ? '；当前显示上次缓存，数据可能不是最新。' : '；当前没有可展示的数据。'}`)
      return false
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [acceptUser])

  useEffect(() => {
    if (!user) return
    const cached = readLocal(user.id, mode)
    setStore(cached || EMPTY_STORE)
    setProjectId(Object.keys(cached?.projects || {})[0] || DEFAULT_PROJECT_ID)
    setUsingCache(!!cached)
    void refreshStore()
  }, [user, mode, refreshStore])

  const login = useCallback(async (username: string, password: string) => {
    const next = await loginRequest(username, password)
    acceptUser(next)
    return next
  }, [acceptUser])

  const register = useCallback(async (username: string, password: string) => {
    const next = await registerRequest(username, password)
    acceptUser(next)
    return next
  }, [acceptUser])

  const logout = useCallback(async () => {
    await logoutRequest()
    const current = userRef.current
    const currentMode = modeRef.current
    if (current) removeLocal(current.id, currentMode)
    acceptUser(null)
  }, [acceptUser])

  const handleWriteFailure = useCallback((cause: unknown) => {
    if (modeRef.current === 'cloud' && cause instanceof CloudError && cause.status === 401) {
      const current = userRef.current
      const currentMode = modeRef.current
      if (current) removeLocal(current.id, currentMode)
      acceptUser(null)
      setError('登录状态已失效，请重新登录。')
      return
    }
    setError(cause instanceof CloudError ? cause.message : '写入结果未知，请先读取对账，不要直接重发')
  }, [acceptUser])

  const afterWrite = useCallback(async () => {
    const refreshed = await refreshStore()
    if (!refreshed && userRef.current) setError('写入接口已返回成功，但最新读取未完成；请刷新页面对账，不要直接重复写入。')
  }, [refreshStore])

  const mark = useCallback(async (id: string, status: MarkStatus): Promise<boolean> => {
    if (!userRef.current) throw new CloudError('login_required', '请先登录后继续。', 401)
    try {
      await writeAction('mark', { project: projectId, concept_id: id, status })
      await afterWrite()
      return true
    } catch (cause) {
      handleWriteFailure(cause)
      return false
    }
  }, [projectId, afterWrite, handleWriteFailure])

  const addConcept = useCallback(async (input: SubmitInput): Promise<SubmitResult> => {
    if (!userRef.current) throw new CloudError('login_required', '请先登录后继续。', 401)
    try {
      const result = await writeAction('submit', { ...input, project: input.project || projectId }) as SubmitResult
      if (result.status === 'accepted' || result.status === 'linked') await afterWrite()
      return result
    } catch (cause) {
      handleWriteFailure(cause)
      throw cause
    }
  }, [projectId, afterWrite, handleWriteFailure])

  const addVerification = useCallback(async (conceptId: string, text: string): Promise<boolean> => {
    if (!userRef.current) throw new CloudError('login_required', '请先登录后继续。', 401)
    try {
      await writeAction('verify', { project: projectId, concept_id: conceptId, text: text.trim() })
      await afterWrite()
      return true
    } catch (cause) {
      handleWriteFailure(cause)
      return false
    }
  }, [projectId, afterWrite, handleWriteFailure])

  const deleteConcept = useCallback(async (id: string): Promise<boolean> => {
    if (!userRef.current) throw new CloudError('login_required', '请先登录后继续。', 401)
    try {
      await writeAction('delete', { project: projectId, concept_id: id })
      await afterWrite()
      return true
    } catch (cause) {
      handleWriteFailure(cause)
      return false
    }
  }, [projectId, afterWrite, handleWriteFailure])

  const project = store.projects[projectId]
  const concepts: Concept[] = project?.concepts || []
  const marks: Record<string, MarkStatus> = project?.marks || {}
  const projectName = project?.name || (projectId === DEFAULT_PROJECT_ID ? '学习项目' : projectId)
  const projectIds = Object.keys(store.projects)

  return {
    user,
    mode,
    authLoading,
    store,
    projectIds,
    projectId,
    setProjectId,
    concepts,
    projectName,
    marks,
    mark,
    addConcept,
    addVerification,
    deleteConcept,
    loading: authLoading || (!!user && loading),
    error,
    setError,
    usingCache,
    refreshStore,
    login,
    register,
    logout,
  }
}
