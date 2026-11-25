import { useEffect, useState } from 'react'
import { links } from '../content/links'
import { AuthPanel } from './AuthPanel'

interface Props {
  error: string | null
  onClearError: () => void
  onLogin: (username: string, password: string) => Promise<unknown>
  onRegister: (username: string, password: string) => Promise<unknown>
}

export function LandingPage({ error, onClearError, onLogin, onRegister }: Props) {
  const [prompt, setPrompt] = useState('')
  const [promptError, setPromptError] = useState(false)
  const [copyMessage, setCopyMessage] = useState('')

  useEffect(() => {
    let active = true
    void fetch('/setup-prompt.txt', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('prompt_unavailable')
        return response.text()
      })
      .then((text) => { if (active) setPrompt(text) })
      .catch(() => { if (active) setPromptError(true) })
    return () => { active = false }
  }, [])

  const copy = async () => {
    if (!prompt) return
    try {
      await navigator.clipboard.writeText(prompt)
      setCopyMessage('已复制，可以粘贴给你的 agent。')
    } catch {
      setCopyMessage('浏览器未允许自动复制，请选中下方文字手动复制。')
    }
  }

  return (
    <main className="flex-1 min-h-0 overflow-y-auto garden-bg px-4 py-10 sm:py-14">
      <div className="mx-auto w-full max-w-5xl">
        <section className="text-center max-w-2xl mx-auto">
          <p className="text-xs font-semibold tracking-wide text-leaf-700/70">Build with AI. Grow beyond AI.</p>
          <h2 className="font-display text-2xl sm:text-3xl font-semibold text-ink mt-2">把每次 AI 产出，长成你自己的判断力</h2>
          <p className="text-sm sm:text-base text-leaf-700/70 mt-3 leading-relaxed">用三问拆出真正值得学的知识，长成一棵可标记、可回顾、可验收的知识树。选一条适合你的路开始。</p>
        </section>

        <section className="mt-8 grid gap-4 md:grid-cols-3" aria-label="三种使用方式">
          <article className="rounded-3xl border border-leaf-100 bg-cream/95 p-5 shadow-card flex flex-col">
            <span className="text-xs font-semibold text-leaf-600">01 · 评委体验</span>
            <h3 className="font-display text-lg font-semibold mt-2">直接打开沙箱</h3>
            <p className="text-sm text-leaf-700/70 mt-2 leading-relaxed">登录或注册后，可记录知识、标记理解并写下验收。演示账号：</p>
            <div className="mt-3 rounded-xl border border-honey-200 bg-honey-50 px-3 py-2 text-sm text-honey-700">
              用户名 <code className="font-semibold">{links.sandboxDemo.username}</code><br />
              密码 <code className="font-semibold">{links.sandboxDemo.password}</code>
            </div>
            <a href="#sandbox-login" className="mt-auto pt-4 text-sm font-semibold text-leaf-700 underline underline-offset-2 decoration-leaf-300">去登录 / 注册</a>
          </article>

          <article className="rounded-3xl border border-leaf-100 bg-cream/95 p-5 shadow-card flex flex-col">
            <span className="text-xs font-semibold text-leaf-600">02 · 搬回家</span>
            <h3 className="font-display text-lg font-semibold mt-2">在自己的电脑运行</h3>
            <p className="text-sm text-leaf-700/70 mt-2 leading-relaxed">数据只留在你自己的文件里。复制下方提示词，让 agent 帮你按 README 配置。</p>
            {links.repoUrl ? (
              <a href={links.repoUrl} target="_blank" rel="noopener noreferrer" className="mt-3 text-sm font-semibold text-leaf-700 underline underline-offset-2 decoration-leaf-300">打开代码仓库</a>
            ) : (
              <p className="mt-3 text-xs text-honey-700">仓库地址即将随论坛帖公布</p>
            )}
          </article>

          <article className="rounded-3xl border border-leaf-100 bg-cream/95 p-5 shadow-card flex flex-col">
            <span className="text-xs font-semibold text-leaf-600">03 · 看真实积累</span>
            <h3 className="font-display text-lg font-semibold mt-2">看我们真实树</h3>
            <p className="text-sm text-leaf-700/70 mt-2 leading-relaxed">旧站保留我们自己的真实学习积累，不是预先摆好的演示数据。</p>
            <a href={links.oldSiteUrl} target="_blank" rel="noopener noreferrer" className="mt-auto pt-4 text-sm font-semibold text-leaf-700 underline underline-offset-2 decoration-leaf-300">打开旧站</a>
          </article>
        </section>

        <section className="mt-5 rounded-3xl border border-leaf-100 bg-cream/95 p-5 sm:p-6 shadow-card" aria-labelledby="setup-prompt-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 id="setup-prompt-title" className="font-display text-lg font-semibold">本地安装提示词</h3>
              <p className="text-xs text-leaf-700/60 mt-1">整段复制给你的 agent；仓库地址见上方「搬回家」卡片。</p>
            </div>
            <button type="button" onClick={() => void copy()} disabled={!prompt} className="rounded-full bg-leaf-600 px-4 py-2 text-sm font-semibold text-white hover:bg-leaf-700 disabled:opacity-40">一键复制</button>
          </div>
          {promptError ? (
            <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">提示词暂时读取失败，请刷新页面重试。</p>
          ) : prompt ? (
            <textarea readOnly value={prompt} onFocus={(event) => event.currentTarget.select()} aria-label="本地安装提示词" rows={12} className="mt-4 w-full resize-y rounded-2xl border border-leaf-200 bg-white px-3 py-3 font-mono text-xs leading-relaxed text-ink" />
          ) : (
            <p className="mt-4 text-sm text-leaf-700/60">正在读取提示词…</p>
          )}
          {copyMessage && <p className="mt-2 text-xs text-honey-700">{copyMessage}</p>}
        </section>

        <section id="sandbox-login" className="mt-8 scroll-mt-6">
          <div className="text-center mb-4">
            <h3 className="font-display text-xl font-semibold">进入你的沙箱知识树</h3>
            <p className="text-sm text-leaf-700/60 mt-1">每个账号的数据独立；绑定 agent 时使用自己的个人令牌。</p>
          </div>
          <AuthPanel error={error} onClearError={onClearError} onLogin={onLogin} onRegister={onRegister} />
        </section>
      </div>
    </main>
  )
}
