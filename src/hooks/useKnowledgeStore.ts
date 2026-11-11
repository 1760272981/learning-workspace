import { useState, useEffect, useCallback, useRef } from 'react'
import type { Store, Concept, MarkStatus, SubmitInput, SubmitResult, Verification } from '../types'
import { applySubmit } from '../types'
import { demoStore, DEMO_PROJECT_ID } from '../data/demo-project'

const STORE_KEY = 'lw-store-v1'

function readLocal(): Store | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Store
    if (parsed && typeof parsed === 'object' && parsed.projects) return parsed
    return null
  } catch {
    return null
  }
}

function writeLocal(store: Store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store))
  } catch {
    // 存储不可用时仍保持内存态，界面不崩
  }
}

export interface DeletedSnapshot {
  projectId: string
  concept: Concept
  index: number
}

export function useKnowledgeStore() {
  const [store, setStore] = useState<Store>(() => readLocal() || demoStore)
  const [isDemo, setIsDemo] = useState(() => readLocal() === null)
  const [projectId, setProjectId] = useState<string>(() => {
    const s = readLocal() || demoStore
    return Object.keys(s.projects)[0] || DEMO_PROJECT_ID
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const storeRef = useRef(store)
  storeRef.current = store

  // 首次：本地无数据时，尝试读取 dev 环境 MCP 写入的真实 store；否则用标注的演示数据
  useEffect(() => {
    if (readLocal() !== null) {
      setLoading(false)
      return
    }
    let cancelled = false
    fetch('/api/store')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('no store'))))
      .then((data: Store) => {
        if (cancelled) return
        const ids = Object.keys(data.projects || {})
        if (ids.length > 0 && ids.some((id) => data.projects[id].concepts.length > 0)) {
          setStore(data)
          setIsDemo(false)
          setProjectId(ids[0])
        }
      })
      .catch(() => {
        /* 公网无 /api/store，使用本地/演示数据，属正常 */
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const commit = useCallback((next: Store) => {
    setStore(next)
    writeLocal(next)
    setIsDemo(false)
  }, [])

  const project = store.projects[projectId]
  const concepts: Concept[] = project?.concepts || []
  const marks: Record<string, MarkStatus> = project?.marks || {}
  const projectName = project?.name || (isDemo ? '个人博客网站' : projectId)
  const projectIds = Object.keys(store.projects)

  const mark = useCallback(
    (id: string, status: MarkStatus) => {
      const s = storeRef.current
      const p = s.projects[projectId]
      if (!p) return
      const next: Store = {
        ...s,
        projects: { ...s.projects, [projectId]: { ...p, marks: { ...(p.marks || {}), [id]: status } } },
      }
      commit(next)
    },
    [projectId, commit]
  )

  const addConcept = useCallback(
    (input: SubmitInput): SubmitResult => {
      const s = structuredClone(storeRef.current)
      const result = applySubmit(s, { ...input, project: input.project || projectId })
      if (result.status === 'accepted' || result.status === 'linked') commit(s)
      return result
    },
    [projectId, commit]
  )

  const addVerification = useCallback(
    (conceptId: string, text: string) => {
      const s = storeRef.current
      const p = s.projects[projectId]
      if (!p) return
      const v: Verification = {
        id: `v_${Math.random().toString(36).slice(2, 10)}`,
        text: text.trim(),
        created_at: new Date().toISOString(),
      }
      const next: Store = {
        ...s,
        projects: {
          ...s.projects,
          [projectId]: {
            ...p,
            concepts: p.concepts.map((c) =>
              c.id === conceptId ? { ...c, verifications: [...(c.verifications || []), v] } : c
            ),
          },
        },
      }
      commit(next)
    },
    [projectId, commit]
  )

  const deleteConcept = useCallback(
    (id: string): DeletedSnapshot | null => {
      const s = storeRef.current
      const p = s.projects[projectId]
      if (!p) return null
      const index = p.concepts.findIndex((c) => c.id === id)
      if (index < 0) return null
      const concept = p.concepts[index]
      const next: Store = {
        ...s,
        projects: { ...s.projects, [projectId]: { ...p, concepts: p.concepts.filter((c) => c.id !== id) } },
      }
      commit(next)
      return { projectId, concept, index }
    },
    [projectId, commit]
  )

  const restoreConcept = useCallback(
    (snap: DeletedSnapshot) => {
      const s = storeRef.current
      const p = s.projects[snap.projectId]
      if (!p) return
      const concepts = [...p.concepts]
      concepts.splice(Math.min(snap.index, concepts.length), 0, snap.concept)
      commit({ ...s, projects: { ...s.projects, [snap.projectId]: { ...p, concepts } } })
    },
    [commit]
  )

  return {
    store,
    projectIds,
    projectId,
    setProjectId,
    concepts,
    projectName,
    isDemo,
    marks,
    mark,
    addConcept,
    addVerification,
    deleteConcept,
    restoreConcept,
    loading,
    error,
    setError,
  }
}
