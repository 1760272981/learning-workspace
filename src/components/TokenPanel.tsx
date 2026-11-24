import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CloudError, createPersonalToken, fetchTokens, revokePersonalToken, type PersonalToken, type User } from '../api'

interface TokenPanelProps {
  user: User
  onClose: () => void
  onNotify: (message: string, kind?: 'success' | 'error' | 'info') => void
}

export function TokenPanel({ user, onClose, onNotify }: TokenPanelProps) {
  const [tokens, setTokens] = useState<PersonalToken[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [label, setLabel] = useState('')
  const [plaintext, setPlaintext] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copyMessage, setCopyMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setTokens(await fetchTokens())
      setError(null)
    } catch (cause) {
      setError(cause instanceof CloudError ? cause.message : '令牌列表读取失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const create = async (event: FormEvent) => {
    event.preventDefault()
    const value = label.trim()
    if (!value || busy) return
    setBusy(true)
    setError(null)
    setCopyMessage('')
    try {
      const created = await createPersonalToken(value)
      setPlaintext(created.token)
      setLabel('')
      onNotify('个人令牌已创建，请立即复制并保存。', 'success')
      try {
        setTokens(await fetchTokens())
      } catch (cause) {
        setError(cause instanceof CloudError ? cause.message : '令牌已创建，但列表刷新失败，请重新打开面板核对。')
      }
    } catch (cause) {
      setError(cause instanceof CloudError ? cause.message : '令牌创建失败')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (token: PersonalToken) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await revokePersonalToken(token.id)
      setTokens((current) => current.map((item) => item.id === token.id ? { ...item, revoked_at: new Date().toISOString() } : item))
      onNotify('令牌已吊销，使用它的 agent 将无法再写入。', 'info')
    } catch (cause) {
      setError(cause instanceof CloudError ? cause.message : '令牌吊销失败')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!plaintext) return
    try {
      await navigator.clipboard.writeText(plaintext)
      setCopyMessage('已复制。关闭面板后不会再显示明文。')
    } catch {
      setCopyMessage('浏览器未允许自动复制，请选中上方令牌手动复制。')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/30 p-0 sm:p-4 backdrop-blur-[2px]" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="token-title" onClick={(event) => event.stopPropagation()} className="max-h-[88vh] w-full sm:max-w-lg overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-leaf-100 bg-cream p-5 sm:p-6 shadow-pop">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="token-title" className="font-display text-lg font-semibold text-ink">我的令牌</h2>
            <p className="mt-1 text-xs text-leaf-700/70">供 {user.username} 的 agent 使用。明文只在创建时显示一次。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭令牌面板" className="w-8 h-8 rounded-full text-2xl leading-none text-leaf-700/50 hover:bg-leaf-100 hover:text-ink">×</button>
        </div>

        <form onSubmit={create} className="mt-5 space-y-2">
          <label htmlFor="token-label" className="block text-xs font-semibold text-leaf-700/80">给令牌起个名字</label>
          <div className="flex gap-2">
            <input id="token-label" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} required disabled={busy} placeholder="例如：我的写作 agent"
              className="min-w-0 flex-1 rounded-xl border border-leaf-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-leaf-500" />
            <button type="submit" disabled={busy || !label.trim()} className="shrink-0 rounded-full bg-leaf-600 px-4 py-2 text-sm font-semibold text-white hover:bg-leaf-700 disabled:opacity-40">创建</button>
          </div>
        </form>

        {plaintext && (
          <div className="mt-4 rounded-2xl border border-honey-300 bg-honey-50 p-3">
            <p className="text-xs font-semibold text-honey-700">新令牌（只显示这一次）</p>
            <input readOnly value={plaintext} onFocus={(event) => event.currentTarget.select()} aria-label="新令牌明文" className="mt-2 w-full rounded-xl border border-honey-200 bg-white px-3 py-2 font-mono text-xs text-ink" />
            <div className="mt-2 flex items-center gap-3">
              <button type="button" onClick={() => void copy()} className="text-xs font-semibold text-leaf-700 underline underline-offset-2 decoration-leaf-300">复制令牌</button>
              <button type="button" onClick={() => { setPlaintext(null); setCopyMessage('') }} className="text-xs text-leaf-700/60">清除显示</button>
            </div>
            {copyMessage && <p className="mt-1 text-[11px] text-honey-700">{copyMessage}</p>}
          </div>
        )}

        {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">已有令牌</h3>
            <button type="button" onClick={() => void load()} disabled={loading || busy} className="text-xs text-leaf-700 underline underline-offset-2 decoration-leaf-300">刷新</button>
          </div>
          {loading ? (
            <p className="py-4 text-sm text-leaf-700/60">正在读取令牌列表…</p>
          ) : tokens.length === 0 ? (
            <p className="rounded-xl border border-leaf-100 bg-white/60 px-3 py-4 text-sm text-leaf-700/60">还没有令牌。创建后配置到 agent 的 LW_USER_TOKEN。</p>
          ) : (
            <ul className="space-y-2">
              {tokens.map((token) => (
                <li key={token.id} className="flex items-center gap-3 rounded-xl border border-leaf-100 bg-white/70 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{token.label}</p>
                    <p className="text-[11px] text-leaf-700/55">{token.created_at.slice(0, 10)} · {token.revoked_at ? '已吊销' : '可使用'}</p>
                  </div>
                  {!token.revoked_at && <button type="button" onClick={() => void revoke(token)} disabled={busy} className="rounded-full border border-red-200 px-3 py-1 text-xs text-red-500 hover:bg-red-50 disabled:opacity-40">吊销</button>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="mt-5 text-[11px] leading-relaxed text-leaf-700/55">令牌明文不会写入浏览器存储、代码或仓库。丢失后只能新建；吊销后无法恢复。</p>
      </section>
    </div>
  )
}
