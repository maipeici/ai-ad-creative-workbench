import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Meta, ProjectSummary } from '../types'
import type { PhaseProps } from '../App'
import Dashboard, { PHASES } from './Dashboard'
import Icon from './Icon'
import Phase1 from '../phases/Phase1Foundation'
import Phase2 from '../phases/Phase2Brief'
import Phase3 from '../phases/Phase3Concept'
import Phase4 from '../phases/Phase4Storyboard'
import Phase5 from '../phases/Phase5Review'
import Phase6 from '../phases/Phase6Render'
import { createDemoProject } from '../demo/demo-project'
import { STEP_DURATION_MS, TOUR_STEPS } from '../demo/tour-steps'
import '../styles/tour.css'

const noop = () => {}
const noWrite = async () => {}

export default function GuidedTour({ meta, onClose }: { meta: Meta; onClose: () => void }) {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const elapsedRef = useRef(0)
  const dialog = useRef<HTMLDivElement>(null)
  const preview = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const project = useMemo(() => createDemoProject(meta), [meta])
  const step = TOUR_STEPS[index]
  const last = index === TOUR_STEPS.length - 1
  const go = (next: number) => {
    setIndex(Math.max(0, Math.min(TOUR_STEPS.length - 1, next)))
    elapsedRef.current = 0
    setElapsed(0)
  }

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const root = document.getElementById('root')
    const wasInert = root?.inert || false
    if (root) root.inert = true
    dialog.current?.querySelector<HTMLButtonElement>('[data-tour-close]')?.focus()
    const hidden = () => { if (document.hidden) setPlaying(false) }
    document.addEventListener('visibilitychange', hidden)
    return () => {
      if (root) root.inert = wasInert
      document.removeEventListener('visibilitychange', hidden)
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  useEffect(() => {
    if (!playing) return
    let previous = performance.now()
    const timer = window.setInterval(() => {
      const now = performance.now()
      if (document.hidden) { previous = now; return }
      elapsedRef.current += now - previous
      previous = now
      setElapsed(elapsedRef.current)
      if (elapsedRef.current >= STEP_DURATION_MS) {
        elapsedRef.current = 0
        setElapsed(0)
        if (index === TOUR_STEPS.length - 1) setPlaying(false)
        else setIndex(i => i + 1)
      }
    }, 100)
    return () => window.clearInterval(timer)
  }, [playing, index])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); return }
      if (event.key === 'ArrowRight') { event.preventDefault(); go(index + 1) }
      if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1) }
      if (event.key !== 'Tab') return
      const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])
        .filter(el => !el.closest('[inert]') && el.getClientRects().length > 0)
      const first = buttons[0], lastButton = buttons[buttons.length - 1]
      if (!first) return
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); lastButton.focus() }
      else if (!event.shiftKey && (document.activeElement === lastButton || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [index])

  useEffect(() => {
    const surface = preview.current
    if (!surface) return
    // The real phase components are visible, but unavailable for editing in the tour.
    surface.inert = true
    surface.scrollTop = 0
    card.current?.scrollTo({ top: 0 })
    const focus = step.phase === 6
      ? surface.querySelector<HTMLElement>('[data-guide="assembly"]')
      : surface.querySelector<HTMLElement>('.studio-hero, section.card, .tour-finish')
    focus?.setAttribute('data-tour-focus', '')
    // Scroll only inside the preview, leaving navigation and the guide bubble fixed.
    if (step.phase === 6 && focus) surface.scrollTop = focus.offsetTop - surface.offsetTop - 20
    surface.querySelectorAll<HTMLVideoElement>('video').forEach(video => {
      video.muted = true
      video.loop = true
      void video.play().catch(() => {})
    })
    return () => {
      focus?.removeAttribute('data-tour-focus')
      surface.querySelectorAll<HTMLVideoElement>('video').forEach(video => video.pause())
    }
  }, [index, step.phase])

  const props: PhaseProps = { project, meta, patch: noWrite, setProject: noop, reloadMeta: noWrite, notify: noop, goto: noop, preview: true }
  const summary: ProjectSummary = { id: project.id, name: project.name, phase: 1, updatedAt: project.updatedAt, channel: project.brief.channel, durationSec: 15, shotCount: 4, variantCount: 0, approved: false, finalVideo: null }
  const chapters = [{ id: 0, name: '总览' }, ...PHASES]
  const phase = PHASES.find(p => p.id === step.phase)

  return createPortal(<div ref={dialog} className="tour-shell" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-notice">
    <header className="tour-header">
      <div className="tour-brand"><img src="/brand/hxz-icon.png" alt="" /><div><h2 id="tour-title">工作台操作指南</h2><p id="tour-notice">独立示例 · 不保存修改、不调用生成</p></div></div>
      <button data-tour-close className="tour-exit" onClick={onClose}>退出导览 <Icon name="close" width="16" /></button>
    </header>
    <nav className="tour-chapters" aria-label="导览阶段">
      {chapters.map(chapter => <button key={chapter.id} className={step.phase === chapter.id ? 'active' : ''} aria-current={step.phase === chapter.id ? 'step' : undefined}
        onClick={() => { setPlaying(false); go(TOUR_STEPS.findIndex(s => s.phase === chapter.id)) }}><span>{chapter.id === 0 ? '◎' : `0${chapter.id}`}</span>{chapter.name}</button>)}
    </nav>
    <div className="tour-body">
      <div className="tour-stage">
        <div className="tour-preview-label"><span className="live-dot" />{phase ? phase.name : last ? '准备开始创作' : '项目工作台'}<span>{step.phase === 6 ? '历史成片 · 仅供展示' : '固定演示示例'}</span></div>
        <div ref={preview} className="tour-preview" key={step.id} aria-label={`${step.label}示例界面`}>
          {step.phase === 0 && <Dashboard projects={[summary]} meta={meta} busy={false} onCreate={noop} onOpen={noop} />}
          {phase && <div className="phase-content">
            <div className="phase-intro"><div><div className="eyebrow">STEP 0{phase.id}</div><h1>{phase.name}</h1><p>{phase.desc}</p></div></div>
            {step.phase === 1 && <Phase1 {...props} foundationTab={step.tab} />}
            {step.phase === 2 && <Phase2 {...props} />}
            {step.phase === 3 && <Phase3 {...props} />}
            {step.phase === 4 && <Phase4 {...props} />}
            {step.phase === 5 && <Phase5 {...props} />}
            {step.phase === 6 && <Phase6 {...props} />}
          </div>}
          {last && <div className="tour-finish"><div className="tour-finish-icon"><Icon name="check" width="32" height="32" /></div><p className="eyebrow">READY TO CREATE</p><h1>把第一个想法，<br />变成一条好广告。</h1><p>品牌资料 → 投放需求 → 创意 → 分镜 → 自动审核 → 成片</p><div className="tour-finish-checks"><span>准备品牌与已确认事实</span><span>写清人群、场景和目标</span><span>逐步生成、校验与制作</span></div><small>真实生成需要配置相应模型；视频合成需要 FFmpeg。</small></div>}
        </div>
      </div>
      <aside className="tour-guide-column" aria-label="当前步骤讲解">
        <div className="tour-bubble">
          <div className="tour-bubble-meta"><span><Icon name="spark" width="15" />流程讲解</span><strong>{String(index + 1).padStart(2, '0')}<small> / {TOUR_STEPS.length}</small></strong></div>
          <div className="tour-progress" role="progressbar" aria-label="导览进度" aria-valuemin={0} aria-valuemax={TOUR_STEPS.length} aria-valuenow={index + 1}><span style={{width: `${last ? 100 : ((index + Math.min(elapsed / STEP_DURATION_MS, 1)) / TOUR_STEPS.length) * 100}%`}} /></div>
          <div ref={card} className="tour-copy" aria-live="polite" aria-atomic="true">
            <span className="tour-step-label">{step.label}</span><h3>{step.title}</h3>
            <p className="tour-what">{step.what}</p>
            <div className="tour-action"><span>你需要做什么</span><p>{step.action}</p></div>
            <div className="tour-output"><Icon name="check" width="16" /><div><span>这一步的产出</span><p>{step.output}</p></div></div>
          </div>
          <div className="tour-controls"><button className="btn-ghost" disabled={index === 0} onClick={() => go(index - 1)}>上一步</button><button className="btn-primary" onClick={() => last ? onClose() : go(index + 1)}>{last ? '返回工作台' : '下一步'}<Icon name="arrow" width="15" /></button></div>
          <div className="tour-playback"><button onClick={() => { if (last && !playing) go(0); setPlaying(!playing) }}><Icon name={playing ? 'pause' : 'play'} width="15" />{playing ? '暂停演示' : last ? '重播演示' : '自动演示'}</button><span>{playing ? '每步 7.5 秒 · 可随时暂停' : '按自己的节奏阅读'}</span></div>
        </div>
        <div className="tour-step-dots" aria-label="选择导览步骤">{TOUR_STEPS.map((item, i) => <button key={item.id} aria-label={`第 ${i + 1} 步：${item.label}`} aria-current={i === index ? 'step' : undefined} title={item.label} className={i === index ? 'active' : i < index ? 'visited' : ''} onClick={() => { setPlaying(false); go(i) }} />)}</div>
        <p className="tour-keyboard-hint">← → 切换步骤 · Esc 退出 · 随时可重播</p>
      </aside>
    </div>
  </div>, document.body)
}
