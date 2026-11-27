import { useState, useEffect, useCallback, useRef } from 'react'
import type { ProjectEvent, UserAcceptance } from '../types'
import { CloudError, acceptUpdate, fetchUpdates, type User } from '../api'

export function useProjectUpdates(user: User | null, mode: 'local' | 'cloud') {
  const [events, setEvents] = useState<ProjectEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const userRef = useRef<User | null>(null)
  const requestSeq = useRef(0)

  const refresh = useCallback(async (): Promise<boolean> => {
    const current = userRef.current
    if (!current) return false
    const seq = ++requestSeq.current
    setLoading(true)
    try {
      const data = await fetchUpdates()
      if (seq !== requestSeq.current || userRef.current?.id !== current.id) return false
      setEvents(data)
      setError(null)
      setLoaded(true)
      return true
    } catch (cause) {
      if (seq !== requestSeq.current || userRef.current?.id !== current.id) return false
      setError(cause instanceof CloudError ? cause.message : '项目更新读取失败，请稍后重试')
      setLoaded(true)
      return false
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    userRef.current = user
    requestSeq.current += 1
    setEvents([])
    setError(null)
    setLoaded(false)
    if (user) void refresh()
  }, [user, mode, refresh])

  const accept = useCallback(async (event: ProjectEvent, decision: 'accepted' | 'rejected', note?: string): Promise<UserAcceptance | null> => {
    try {
      const acceptance = await acceptUpdate(event.project_id, event.id, decision, note)
      const refreshed = await refresh()
      if (!refreshed) setError('验收接口已返回成功，但最新读取未完成；请刷新页面对账，不要直接重复写入。')
      return acceptance
    } catch (cause) {
      setError(cause instanceof CloudError ? cause.message : '验收写入结果未知，请刷新核对，不要直接重复写入')
      return null
    }
  }, [refresh])

  return { events, loading, loaded, error, setError, refresh, accept }
}