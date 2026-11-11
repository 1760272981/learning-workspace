import { useEffect } from 'react'
import { motion } from 'framer-motion'

export type ToastKind = 'success' | 'info' | 'warning' | 'error'

export interface ToastItem {
  id: string
  kind: ToastKind
  message: string
  actionLabel?: string
  onAction?: () => void
}

const STYLE: Record<ToastKind, { bar: string; icon: string; ring: string }> = {
  success: { bar: 'bg-leaf-600', icon: 'M5 13l4 4L19 7', ring: 'border-leaf-200' },
  info: { bar: 'bg-blue-500', icon: 'M12 8h.01M11 12h1v4h1', ring: 'border-blue-200' },
  warning: { bar: 'bg-honey-500', icon: 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z', ring: 'border-honey-300' },
  error: { bar: 'bg-red-500', icon: 'M6 6l12 12M18 6L6 18', ring: 'border-red-200' },
}

function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const s = STYLE[toast.kind]
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), toast.actionLabel ? 6500 : 4200)
    return () => clearTimeout(t)
  }, [toast.id, toast.actionLabel, onDismiss])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.96 }}
      transition={{ type: 'spring', damping: 24, stiffness: 320 }}
      role="status"
      className={`pointer-events-auto flex items-center gap-3 rounded-2xl border ${s.ring} bg-white/95 backdrop-blur px-4 py-3 shadow-pop max-w-[92vw] sm:max-w-md`}
    >
      <span className={`shrink-0 w-7 h-7 rounded-full ${s.bar} flex items-center justify-center`}>
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d={s.icon} />
        </svg>
      </span>
      <p className="text-sm text-ink leading-snug flex-1 min-w-0">{toast.message}</p>
      {toast.actionLabel && toast.onAction && (
        <button
          onClick={() => { toast.onAction?.(); onDismiss(toast.id) }}
          className="shrink-0 text-sm font-semibold text-leaf-700 hover:text-leaf-800 underline underline-offset-2 decoration-leaf-300"
        >
          {toast.actionLabel}
        </button>
      )}
      <button onClick={() => onDismiss(toast.id)} aria-label="关闭提示" className="shrink-0 text-leaf-700/40 hover:text-ink text-lg leading-none w-6 h-6 rounded-full hover:bg-leaf-50">×</button>
    </motion.div>
  )
}

export function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 pointer-events-none">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}