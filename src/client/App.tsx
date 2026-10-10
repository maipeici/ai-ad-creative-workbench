import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import type { Meta, Project, ProjectSummary } from './types'
import { Badge, Modal, Spinner, Toast } from './ui'
import Dashboard, { PHASES, formatDate, projectStatus } from './components/Dashboard'
import Icon from './components/Icon'
import Phase1 from './phases/Phase1Foundation'
import Phase2 from './phases/Phase2Brief'
import Phase3 from './phases/Phase3Concept'
import Phase4 from './phases/Phase4Storyboard'
import Phase5 from './phases/Phase5Review'
import Phase6 from './phases/Phase6Render'

export interface PhaseProps {
  project: Project
  meta: Meta
  patch: (p: Record<string, unknown>) => Promise<void>
  setProject: (p: Project) => void
  reloadMeta: () => Promise<void>
  notify: (msg: string, tone?: 'error' | 'ok') => void
  goto: (n: number) => void
}
const LAST_KEY = 'hxz-wf-last-project'
function remember(id: string | null) {
  try { id ? localStorage.setItem(LAST_KEY, id) : localStorage.removeItem(LAST_KEY) } catch { /* Storage may be disabled. */ }
}
function recalled() {
  try { return localStorage.getItem(LAST_KEY) } catch { return null }
}

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [activePhase, setActivePhase] = useState(1)
  const [view, setView] = useState<'overview' | 'project'>('overview')
  const [toast, setToast] = useState<{ msg: string; tone?: 'error' | 'ok' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(0)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarSearch, setSidebarSearch] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()
  const openSequence = useRef(0)
  const phaseNavigation = useRef<HTMLElement>(null)

  const notify = useCallback((msg: string, tone: 'error' | 'ok' = 'ok') => {
    clearTimeout(toastTimer.current)
    setToast({ msg, tone })
    toastTimer.current = setTimeout(() => setToast(null), 4200)
  }, [])
  useEffect(() => () => clearTimeout(toastTimer.current), [])
  const reloadMeta = useCallback(async () => {
    setMeta(await api.meta())
    if (project?.id) { const fresh = await api.getProject(project.id); setProject(current => current?.id === fresh.id ? fresh : current) }
  }, [project?.id])
  const reloadProjects = useCallback(async () => setProjects(await api.listProjects()), [])
  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [m, list] = await Promise.all([api.meta(), api.listProjects()])
      setMeta(m)
      setProjects(list)
      const last = recalled()
      if (last && list.some(p => p.id === last)) {
        try { setProject(await api.getProject(last)) } catch { remember(null) }
      } else if (last) remember(null)
    } catch (e: any) {
      setLoadError(e.message || '暂时无法连接本地服务')
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const openProject = async (id: string, phase?: number) => {
    const sequence = ++openSequence.current
    setBusy(true)
    try {
      const p = await api.getProject(id)
      if (sequence !== openSequence.current) return
      setProject(p)
      setActivePhase(phase || p.phase || 1)
      setView('project')
      setMenuOpen(false)
      remember(id)
    } catch (e: any) { notify(e.message, 'error') }
    finally { if (sequence === openSequence.current) setBusy(false) }
  }
  const prepareCreate = () => {
    setNewName('花小猪广告 ' + new Date().toLocaleDateString('zh-CN'))
    setShowCreate(true)
    setMenuOpen(false)
  }
  const createProject = async () => {
    if (busy || !newName.trim()) return
    setBusy(true)
    try {
      const p = await api.createProject(newName.trim())
      setProject(p)
      setActivePhase(1)
      setView('project')
      remember(p.id)
      setShowCreate(false)
      await reloadProjects()
      notify('项目已创建，从创作基础开始吧')
    } catch (e: any) { notify(e.message, 'error') }
    finally { setBusy(false) }
  }
  const removeProject = async () => {
    if (!deleteTarget || busy) return
    setBusy(true)
    try {
      await api.deleteProject(deleteTarget.id)
      if (project?.id === deleteTarget.id) {
        setProject(null)
        setView('overview')
        remember(null)
      }
      await reloadProjects()
      setDeleteTarget(null)
      notify('项目已删除')
    } catch (e: any) { notify(e.message, 'error') }
    finally { setBusy(false) }
  }
  const patch = useCallback(async (p: Record<string, unknown>) => {
    if (!project) return
    const id = project.id
    setSaving(n => n + 1)
    try {
      const updated = await api.patchProject(id, p)
      setProject(current => current?.id === id ? updated : current)
      if (updated._impact?.shots?.length) notify('设定已修改：' + updated._impact.note, 'error')
      await reloadProjects()
    } catch (e: any) {
      notify('保存失败：' + e.message, 'error')
      throw e
    } finally { setSaving(n => n - 1) }
  }, [project, reloadProjects, notify])
  const setProjectAndRefresh = useCallback((p: Project) => {
    setProject(current => current?.id === p.id ? p : current)
    void reloadProjects().catch(e => notify(e.message, 'error'))
  }, [reloadProjects, notify])
  const phaseReady = useMemo(() => {
    if (!project) return {} as Record<number, boolean>
    return {
      1: Object.values(project.assets || {}).some(v => v.length > 0) && (project.facts || []).length > 0,
      2: Boolean(project.brief?.audience && project.brief?.scene && project.brief?.cta),
      3: Boolean(project.selectedConceptId),
      4: Boolean(project.storyboard?.shots?.length),
      5: Boolean(project.review?.approved),
      6: Boolean(project.render?.finalVideo),
    } as Record<number, boolean>
  }, [project])

  useEffect(() => {
    phaseNavigation.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [activePhase, view, project?.id])

  if (loading || !meta || loadError) {
    return <div className="startup-screen"><div className="startup-mark"><Icon name="spark" width="30" height="30" /></div>
      <h1>花小猪 · AI 创意工作台</h1>
      {loading ? <p className="flex items-center gap-2"><Spinner /> 正在准备你的创作空间…</p> : <><p>工作台暂时无法加载，请确认本地服务已启动。</p><p className="text-xs text-red-300 max-w-md break-words">{loadError}</p><button className="btn-primary mt-3" onClick={load}><Icon name="retry" /> 重新加载</button></>}
    </div>
  }
  const phaseProps: PhaseProps | null = project ? { project, meta, patch, setProject: setProjectAndRefresh, reloadMeta, notify, goto: setActivePhase } : null
  const currentPhase = PHASES.find(ph => ph.id === activePhase) || PHASES[0]
  const visibleProjects = projects.filter(p => p.name.toLowerCase().includes(sidebarSearch.trim().toLowerCase()))
  const configured = !meta.providers.video.startsWith('mock') && !meta.providers.video.startsWith('manual')
  const completed = Object.values(phaseReady).filter(Boolean).length
  const showOverview = () => { setView('overview'); setMenuOpen(false) }
  const channelName = (id?: string) => meta.channels.find(c => c.id === id)?.name || '未选择渠道'

  return <div className="studio-shell">
    {menuOpen && <button className="sidebar-scrim" aria-label="关闭导航" onClick={() => setMenuOpen(false)} />}
    <aside className={'studio-sidebar ' + (menuOpen ? 'is-open' : '')} aria-label="工作台导航">
      <button className="studio-brand" onClick={showOverview} aria-label="花小猪创意工作台首页">
        <img src="/brand/hxz-icon.png" alt="" /><div><strong>花小猪<span>创意工作台</span></strong><small>AI AD CREATIVE STUDIO</small></div>
      </button>
      <button className={'sidebar-home ' + (view === 'overview' ? 'active' : '')} onClick={showOverview}><Icon name="grid" /> 工作台概览<Icon name="chevron" width="14" /></button>
      <div className="sidebar-section-title"><span>我的素材项目</span><button aria-label="新建素材项目" title="新建素材项目" onClick={prepareCreate} disabled={busy}><Icon name="plus" width="17" /></button></div>
      <label className="sidebar-search"><Icon name="search" width="14" /><input aria-label="搜索侧栏项目" placeholder="搜索项目…" value={sidebarSearch} onChange={e => setSidebarSearch(e.target.value)} /></label>
      <div className="sidebar-projects">
        {visibleProjects.map(p => {
          const status = projectStatus(p)
          return <div key={p.id} className={'sidebar-project ' + (view === 'project' && project?.id === p.id ? 'active' : '')}>
            <button className="sidebar-project-open" onClick={() => openProject(p.id)} disabled={busy}>
              <Icon name={p.finalVideo ? 'movie' : 'layers'} width="16" />
              <span><strong>{p.name}</strong><small><span className={'status-dot ' + status.tone} />{status.label}<span className="ml-auto">{formatDate(p.updatedAt)}</span></small></span>
            </button>
            <button className="project-delete" aria-label={'删除项目 ' + p.name} onClick={() => setDeleteTarget(p)} disabled={busy}><Icon name="trash" width="14" /></button>
          </div>
        })}
        {visibleProjects.length === 0 && <p className="px-3 py-5 text-xs text-slate-500">{sidebarSearch ? '没有匹配的项目' : '新建项目后会显示在这里。'}</p>}
      </div>
      <button className="sidebar-create" onClick={prepareCreate} disabled={busy}><Icon name="plus" /> 新建素材项目</button>
      <div className="sidebar-bottom"><span className="sidebar-avatar">创</span><div><strong>花小猪创意空间</strong><small>本地工作台 · 项目已保存至本机</small></div></div>
    </aside>
    <div className="studio-main">
      <header className="studio-topbar">
        <button className="mobile-menu icon-button" aria-label="展开导航" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button>
        <div className="topbar-breadcrumb"><span>创意空间</span><Icon name="chevron" width="13" /><strong>{view === 'overview' ? '工作台概览' : currentPhase.name}</strong>{busy && <Spinner />}</div>
        <div className="ml-auto flex items-center gap-3"><button className={'environment-button ' + (configured && meta.ffmpeg ? 'configured' : '')} onClick={() => setShowSettings(true)}><span className="status-dot" />{!meta.ffmpeg ? '合成待配置' : configured ? '模型已配置' : meta.videoMode === 'manual' ? '手动制作模式' : '演示模式'}<Icon name="settings" width="14" /></button><span className="topbar-avatar">花</span></div>
      </header>
      {view === 'overview' || !project ? <div className="studio-scroll"><Dashboard projects={projects} meta={meta} lastId={project?.id} busy={busy} onOpen={openProject} onCreate={prepareCreate} /></div> :
        <div className="project-workspace">
          <div className="workspace-heading">
            <button className="text-link mb-3" onClick={showOverview}>← 返回项目总览</button>
            <div className="workspace-title-row"><div className="min-w-0 flex-1"><input className="project-name-input" aria-label="项目名称" value={project.name} onChange={e => setProject({ ...project, name: e.target.value })} onBlur={e => { const name = e.target.value.trim(); if (name && name !== projects.find(p => p.id === project.id)?.name) void patch({ name }).catch(() => {}); else if (!name) setProject({ ...project, name: projects.find(p => p.id === project.id)?.name || '未命名素材项目' }) }} />
              <div className="workspace-meta"><span>{channelName(project.brief?.channel)}</span><span>·</span><span>{project.brief?.durationSec || '—'} 秒</span><span>·</span><span>{project.storyboard?.shots?.length || 0} 个镜头</span><span className="save-indicator">{saving ? '正在保存…' : project.name !== projects.find(p => p.id === project.id)?.name ? '编辑中' : '已保存'}</span></div></div>
              <div className="workspace-progress"><strong>{completed}<small> / 6</small></strong><span>阶段已就绪</span></div>
            </div>
          </div>
          <nav ref={phaseNavigation} className="phase-navigation" aria-label="创作阶段">
            {PHASES.map(ph => <button key={ph.id} className={(activePhase === ph.id ? 'active ' : '') + (phaseReady[ph.id] ? 'ready' : '')} onClick={() => setActivePhase(ph.id)} aria-current={activePhase === ph.id ? 'step' : undefined}><span className="phase-number">{phaseReady[ph.id] ? <Icon name="check" width="13" height="13" /> : '0' + ph.id}</span><span>{ph.name}</span></button>)}
          </nav>
          <div className="phase-scroll" key={project.id + '-' + activePhase}>
            <div className="phase-content animate-in">
              <div className="phase-intro"><div><div className="eyebrow">STEP {'0' + activePhase}</div><h1>{currentPhase.name}</h1><p>{currentPhase.desc}</p></div><Badge tone={phaseReady[activePhase] ? 'green' : 'slate'}>{phaseReady[activePhase] ? '本阶段已就绪' : '待完善'}</Badge></div>
              {phaseProps && activePhase === 1 && <Phase1 {...phaseProps} />}
              {phaseProps && activePhase === 2 && <Phase2 {...phaseProps} />}
              {phaseProps && activePhase === 3 && <Phase3 {...phaseProps} />}
              {phaseProps && activePhase === 4 && <Phase4 {...phaseProps} />}
              {phaseProps && activePhase === 5 && <Phase5 {...phaseProps} />}
              {phaseProps && activePhase === 6 && <Phase6 {...phaseProps} />}
              <div className="phase-footer-nav"><button className="btn-ghost" onClick={() => activePhase === 1 ? showOverview() : setActivePhase(activePhase - 1)}>{activePhase === 1 ? '返回总览' : '← 上一阶段'}</button>{activePhase < 6 && <button className="btn-primary" onClick={() => setActivePhase(activePhase + 1)}>下一阶段：{PHASES[activePhase].name}<Icon name="arrow" width="16" /></button>}</div>
            </div>
          </div>
        </div>}
    </div>
    <Modal open={showCreate} title="开启一个新的广告创意" onClose={() => !busy && setShowCreate(false)}>
      <form onSubmit={e => { e.preventDefault(); void createProject() }} className="space-y-5">
        <p className="text-sm text-slate-400 leading-relaxed">为素材项目起个名字。接下来，我们会从创作基础开始，逐步完成投放需求、创意、分镜与成片。</p>
        <div><label className="label" htmlFor="new-project-name">项目名称</label><input id="new-project-name" className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="例如：晚高峰通勤 · 抖音 15 秒广告" required maxLength={100} /></div>
        <div className="creation-steps">{['创作基础', '投放需求', '创意分镜', '审核成片'].map((label, i) => <span key={label}><small>{i + 1}</small>{label}</span>)}</div>
        <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={() => setShowCreate(false)} disabled={busy}>取消</button><button type="submit" className="btn-primary" disabled={busy || !newName.trim()}>{busy ? <Spinner /> : <Icon name="plus" width="16" />}创建项目</button></div>
      </form>
    </Modal>
    <Modal open={!!deleteTarget} title="删除素材项目" onClose={() => !busy && setDeleteTarget(null)}>
      <p className="text-sm text-slate-300 leading-relaxed">确定删除「{deleteTarget?.name}」吗？该项目的需求、创意和分镜记录将被移除，删除后无法在工作台恢复。</p>
      <div className="flex justify-end gap-2 mt-6"><button className="btn-ghost" onClick={() => setDeleteTarget(null)} disabled={busy}>保留项目</button><button className="btn-danger" onClick={removeProject} disabled={busy}>{busy && <Spinner />}确定删除</button></div>
    </Modal>
    <Modal open={showSettings} title="工作台运行状态" onClose={() => setShowSettings(false)}>
      <p className="text-sm text-slate-400 leading-relaxed mb-5">{configured ? '已读取模型配置，实际可用性以生成结果为准。' : '当前可浏览项目、编辑需求并查看已有成片。未配置的生成能力使用演示结果。'}</p>
      <div className="space-y-3">{[
        ['创意文案', meta.providers.llm.startsWith('mock') ? '演示结果' : '已配置'],
        ['分镜图像', meta.providers.image.startsWith('mock') ? '演示结果' : '已配置'],
        ['视频生成', configured ? '已配置' : meta.videoMode === 'manual' ? '手动回传' : '演示结果'],
        ['口播配音', meta.ttsEnabled ? '已配置' : '尚未配置'],
        ['视频合成', meta.ffmpeg ? '可用' : '尚未安装合成工具'],
        ['中文字幕', meta.subtitleFont ? '字体可用' : '尚未找到中文字体'],
      ].map(([label, value]) => <div className="environment-row" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <div className="flex justify-end mt-5"><button className="btn-ghost" onClick={async () => { try { await reloadMeta(); notify('运行状态已刷新') } catch (e: any) { notify(e.message, 'error') } }}><Icon name="retry" width="15" />刷新状态</button></div>
    </Modal>
    <Toast msg={toast?.msg || null} tone={toast?.tone} />
  </div>
}