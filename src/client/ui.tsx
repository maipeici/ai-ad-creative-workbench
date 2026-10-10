import React, { useEffect, useId, useRef, useState } from 'react'

export function Section({
  dataGuide,
  title,
  desc,
  right,
  children,
}: {
  dataGuide?: string
  title: string
  desc?: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="card p-5" data-guide={dataGuide}>
      <header className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="section-title">{title}</h3>
          {desc && <p className="section-description">{desc}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="form-field">
      <label className="label">
        <span className="field-title">{label}</span>
        {hint && <span className="field-hint">{hint}</span>}
      </label>
      {children}
    </div>
  )
}

export function Badge({ tone = 'slate', children }: { tone?: string; children: React.ReactNode }) {
  const map: Record<string, string> = {
    slate: 'bg-ink-700 text-slate-400',
    brand: 'bg-brand/15 text-brand-soft',
    green: 'bg-emerald-900/40 text-emerald-300',
    red: 'bg-red-900/40 text-red-300',
    blue: 'bg-sky-900/40 text-sky-300',
    amber: 'bg-amber-900/40 text-amber-300',
  }
  return <span className={`tag ${map[tone] || map.slate}`}>{children}</span>
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin ${className}`}
    />
  )
}

export function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className="btn-ghost !px-2 !py-1 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
        } catch {
          const ta = document.createElement('textarea')
          ta.value = text
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          ta.remove()
        }
        setDone(true)
        setTimeout(() => setDone(false), 1400)
      }}
    >
      {done ? '已复制' : label}
    </button>
  )
}

export function Modal({
  open, title, onClose, children, wide,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}) {
  const dialog = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const titleId = useId()
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const frame = requestAnimationFrame(() => {
      const input = dialog.current?.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled]), select:not([disabled])')
      ;(input || dialog.current?.querySelector<HTMLElement>('button:not([disabled])'))?.focus()
    })
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close.current(); return }
      if (e.key !== 'Tab') return
      const elements = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') || []).filter(el => el.offsetParent !== null)
      if (!elements.length) { e.preventDefault(); return }
      const first = elements[0], last = elements[elements.length - 1]
      if (e.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handler)
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', handler); previous?.focus() }
  }, [open])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-6" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} className={'card w-full ' + (wide ? 'max-w-4xl' : 'max-w-xl') + ' my-8 shadow-2xl'}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink-600">
          <h3 id={titleId} className="text-sm font-semibold">{title}</h3>
          <button className="text-slate-500 hover:text-slate-200 text-xl leading-none p-1" onClick={onClose} aria-label="关闭弹窗">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
export function Toast({ msg, tone }: { msg: string | null; tone?: 'error' | 'ok' }) {
  if (!msg) return null
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-lg text-sm shadow-xl border ${
        tone === 'error'
          ? 'bg-red-950 border-red-800 text-red-200'
          : 'bg-emerald-950 border-emerald-800 text-emerald-200'
      }`}
    >
      {msg}
    </div>
  )
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-dashed border-ink-600 rounded-lg p-8 text-center text-sm text-slate-500">
      {children}
    </div>
  )
}

/** 校验问题条目：同时展示问题、修复建议与一键修复入口 */
export function IssueRow({
  severity,
  reason,
  term,
  fix,
  onFix,
  fixing,
}: {
  severity: 'block' | 'warn'
  reason: string
  term?: string
  fix?: { action: string; label: string; auto: boolean; preferManual?: boolean }
  onFix?: () => void
  fixing?: boolean
}) {
  const block = severity === 'block'
  return (
    <div
      className={`text-[11px] leading-relaxed px-2.5 py-2 rounded border ${
        block ? 'bg-red-950/40 border-red-800/60 text-red-200' : 'bg-amber-950/30 border-amber-800/50 text-amber-200'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="shrink-0 font-bold">{block ? '阻断' : '提醒'}</span>
        <span className="flex-1">
          {reason}
          {term && <code className="ml-1 px-1 rounded bg-black/30">{term}</code>}
        </span>
      </div>
      {fix && (
        <div className="flex items-start gap-2 mt-1.5 pt-1.5 border-t border-white/10">
          <span className="shrink-0 text-emerald-300 font-bold">改法</span>
          <span className="flex-1 text-slate-300">{fix.label}</span>
          {fix.auto && onFix && (
            <button
              className="shrink-0 px-2 py-0.5 rounded bg-emerald-700/70 hover:bg-emerald-600 text-white text-[10px] font-medium disabled:opacity-50"
              onClick={onFix}
              disabled={fixing}
            >
              {fixing ? '修复中…' : fix.preferManual ? '仍要自动处理' : '一键修复'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** 事实状态标记 */
export function FactStatus({ status }: { status: string }) {
  const map: Record<string, { tone: string; label: string }> = {
    confirmed: { tone: 'green', label: '已确认' },
    pending: { tone: 'amber', label: '待补充' },
    expired: { tone: 'red', label: '已过期' },
  }
  const m = map[status] || { tone: 'slate', label: status }
  return <Badge tone={m.tone}>{m.label}</Badge>
}

/** 镜头生成方式标记 */
export function RenderModeBadge({ mode }: { mode: string }) {
  const map: Record<string, { tone: string; label: string; hint: string }> = {
    ai: { tone: 'blue', label: 'AI 生成', hint: '完全由视频模型生成' },
    overlay: { tone: 'brand', label: '叠加合成', hint: 'AI 画面 + 后期叠加文字/界面/Logo' },
    asset: { tone: 'green', label: '已有素材', hint: '直接使用已确认素材，不经 AI' },
  }
  const m = map[mode] || map.ai
  return (
    <span title={m.hint}>
      <Badge tone={m.tone}>{m.label}</Badge>
    </span>
  )
}

const ROLE_MAP: Record<string, { label: string; tone: string }> = {
  hook: { label: '钩子', tone: 'brand' },
  scene: { label: '共鸣', tone: 'blue' },
  product: { label: '产品', tone: 'green' },
  proof: { label: '佐证', tone: 'green' },
  cta: { label: 'CTA', tone: 'amber' },
}

export function RoleBadge({ role }: { role: string }) {
  const m = ROLE_MAP[role] || { label: role, tone: 'slate' }
  return <Badge tone={m.tone}>{m.label}</Badge>
}
