import { useState, type FormEvent } from 'react'
import { CloudError } from '../api'

interface AuthPanelProps {
  error: string | null
  onClearError: () => void
  onLogin: (username: string, password: string) => Promise<unknown>
  onRegister: (username: string, password: string) => Promise<unknown>
}

export function AuthPanel({ error, onClearError, onLogin, onRegister }: AuthPanelProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    const values = new FormData(form)
    const username = String(values.get('username') || '').trim()
    const password = String(values.get('password') || '')
    form.reset()
    setBusy(true)
    setLocalError(null)
    onClearError()
    try {
      if (mode === 'login') await onLogin(username, password)
      else await onRegister(username, password)
    } catch (cause) {
      setLocalError(cause instanceof CloudError ? cause.message : '请求没有完成，请稍后再试。')
    } finally {
      setBusy(false)
    }
  }

  const switchMode = () => {
    setMode((value) => value === 'login' ? 'register' : 'login')
    setLocalError(null)
    onClearError()
  }

  const message = localError || error

  return (
    <main className="flex-1 min-h-0 overflow-y-auto garden-bg px-4 py-10 sm:py-16">
      <section className="mx-auto w-full max-w-md rounded-3xl border border-leaf-100 bg-cream/95 p-6 sm:p-8 shadow-pop">
        <div className="mb-6">
          <p className="text-xs font-semibold tracking-wide text-leaf-700/70">你的独立学习层</p>
          <h2 className="font-display text-2xl font-semibold text-ink mt-1">登录后，看见自己的知识树</h2>
          <p className="text-sm text-leaf-700/70 mt-2 leading-relaxed">每个人的学习点只归自己。绑定 agent 时，也使用自己的个人令牌。</p>
        </div>

        <div className="mb-5 grid grid-cols-2 rounded-full border border-leaf-200 bg-white/70 p-1" role="tablist" aria-label="登录或注册">
          <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => mode !== 'login' && switchMode()} className={`rounded-full px-3 py-2 text-sm font-semibold ${mode === 'login' ? 'bg-leaf-600 text-white' : 'text-leaf-700'}`}>登录</button>
          <button type="button" role="tab" aria-selected={mode === 'register'} onClick={() => mode !== 'register' && switchMode()} className={`rounded-full px-3 py-2 text-sm font-semibold ${mode === 'register' ? 'bg-leaf-600 text-white' : 'text-leaf-700'}`}>注册</button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="auth-username" className="block text-xs font-semibold text-leaf-700/80 mb-1">用户名</label>
            <input id="auth-username" name="username" autoComplete="username" required minLength={3} maxLength={32} pattern="[A-Za-z0-9_]+" disabled={busy}
              placeholder="3–32 位字母、数字或下划线" className="w-full rounded-xl border border-leaf-200 bg-white px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-leaf-500" />
          </div>
          <div>
            <label htmlFor="auth-password" className="block text-xs font-semibold text-leaf-700/80 mb-1">密码</label>
            <input id="auth-password" name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={8} maxLength={256} disabled={busy}
              placeholder="至少 8 个字符" className="w-full rounded-xl border border-leaf-200 bg-white px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-leaf-500" />
          </div>
          {message && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{message}</p>}
          <button type="submit" disabled={busy} className="w-full rounded-full bg-leaf-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-leaf-700 disabled:opacity-50">
            {busy ? '正在处理…' : mode === 'login' ? '登录' : '注册并进入'}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-leaf-700/60">
          {mode === 'login' ? '第一次使用？' : '已经有账号？'}
          <button type="button" onClick={switchMode} disabled={busy} className="ml-1 font-semibold text-leaf-700 underline underline-offset-2 decoration-leaf-300">
            {mode === 'login' ? '注册一个账号' : '返回登录'}
          </button>
        </p>
      </section>
    </main>
  )
}
