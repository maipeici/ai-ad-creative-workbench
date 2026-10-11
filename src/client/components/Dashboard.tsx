import { useMemo, useState } from 'react'
import type { Meta, ProjectSummary } from '../types'
import Icon from './Icon'

export const PHASES = [
  { id: 1, name: '创作基础', desc: '品牌、活动、素材、视觉与合规各归其位', icon: 'book' },
  { id: 2, name: '投放需求', desc: '明确受众、场景、目标与渠道', icon: 'settings' },
  { id: 3, name: '广告创意', desc: '选择有共鸣的创意与开场钩子', icon: 'spark' },
  { id: 4, name: '分镜规划', desc: '编排画面、口播和字幕', icon: 'layers' },
  { id: 5, name: '自动审核', desc: '按清单自动校验、修复并复检', icon: 'check' },
  { id: 6, name: '成片制作', desc: '生成镜头、合成成片与测试变体', icon: 'movie' },
]

export function projectStatus(p: ProjectSummary) {
  if (p.finalVideo) return { label: '已有成片', tone: 'green' }
  if (p.approved) return { label: '待生成', tone: 'blue' }
  if (p.phase >= 5) return { label: '待审核', tone: 'amber' }
  return { label: '创作中', tone: 'brand' }
}
export function formatDate(value: string) {
  return new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

export default function Dashboard({ projects, meta, lastId, busy, onOpen, onCreate, onGuide }: {
  projects: ProjectSummary[]
  meta: Meta
  lastId?: string
  busy: boolean
  onOpen: (id: string, phase?: number) => void
  onCreate: () => void
  onGuide?: () => void
}) {
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const visible = useMemo(() => projects.filter(p =>
    (filter === 'all' || (filter === 'finished' ? !!p.finalVideo : !p.finalVideo)) &&
    (p.name + ' ' + (meta.channels.find(c => c.id === p.channel)?.name || '')).toLowerCase().includes(search.trim().toLowerCase()),
  ), [projects, meta, filter, search])
  const latestFilm = projects.find(p => p.finalVideo)
  const resume = projects.find(p => p.id === lastId) || projects[0]
  const finished = projects.filter(p => p.finalVideo).length
  const metrics = [
    { label: '素材项目', value: projects.length, detail: '全部创作项目', icon: 'grid', color: 'pink' },
    { label: '已有成片', value: finished, detail: '可预览与下载', icon: 'movie', color: 'green' },
    { label: '待审核项目', value: projects.filter(p => p.phase >= 5 && !p.approved && !p.finalVideo).length, detail: '生成前自动检查', icon: 'check', color: 'amber' },
    { label: '规划镜头', value: projects.reduce((n, p) => n + p.shotCount, 0), detail: '已保存的分镜', icon: 'layers', color: 'blue' },
  ]

  return (
    <div className="dashboard animate-in">
      <section className="studio-hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="live-dot" /> AI CREATIVE STUDIO</div>
          <h1>让好创意，<br className="sm:hidden" />更快成为好广告<span>。</span></h1>
          <p>从投放需求到成片，让品牌、创意和制作在一个工作台里有序协作。</p>
          <div className="flex flex-wrap items-center gap-3 mt-6">
            <button className="btn-primary" onClick={onCreate} disabled={busy}><Icon name="plus" /> 新建素材项目</button>
            {onGuide && <button className="guide-entry hero-guide" onClick={onGuide}><Icon name="play" width="15" />90 秒了解流程</button>}
            {resume && <button className="hero-resume" onClick={() => onOpen(resume.id)} disabled={busy}>继续上次创作 <Icon name="arrow" width="16" /></button>}
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="art-orbit" />
          <div className="art-card art-card-back"><span /><span /><span /></div>
          <div className="art-card art-card-front">
            <Icon name="spark" width="32" height="32" />
            <div className="art-line long" /><div className="art-line short" />
            <div className="art-play"><Icon name="movie" width="22" height="22" /> 创意 → 成片</div>
          </div>
          <div className="art-label"><span className="live-dot" /> 6 阶段创作流程</div>
        </div>
      </section>

      <section className="metric-grid" aria-label="项目统计">
        {metrics.map(m => <div className="metric-card" key={m.label}>
          <div className={'metric-icon ' + m.color}><Icon name={m.icon} width="20" height="20" /></div>
          <div className="metric-value">{m.value}<span>{m.label}</span></div>
          <p>{m.detail}</p>
        </div>)}
      </section>

      <div className="overview-columns">
        <section className="min-w-0">
          <div className="section-heading"><div><h2>我的素材项目 <span>{projects.length}</span></h2><p>接着打磨已有想法，或开启一次新的创作。</p></div></div>
          <div className="project-toolbar">
            <div className="filter-tabs" aria-label="按项目状态筛选">
              {[['all', '全部'], ['progress', '进行中'], ['finished', '已有成片']].map(([id, label]) =>
                <button key={id} className={filter === id ? 'active' : ''} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
            </div>
            <label className="search-box"><Icon name="search" width="16" /><input aria-label="搜索素材项目" placeholder="搜索项目或渠道" value={search} onChange={e => setSearch(e.target.value)} />{search && <button aria-label="清空搜索" onClick={() => setSearch('')}><Icon name="close" width="14" /></button>}</label>
          </div>
          {visible.length > 0 ? <div className="project-grid">
            {visible.map(p => {
              const status = projectStatus(p)
              const phase = PHASES.find(ph => ph.id === p.phase) || PHASES[0]
              return <button className="project-card" key={p.id} onClick={() => onOpen(p.id)} disabled={busy}>
                <div className="flex items-start justify-between gap-3"><div className={'project-mark ' + (p.finalVideo ? 'finished' : '')}><Icon name={p.finalVideo ? 'movie' : phase.icon} width="24" height="24" /></div><span className={'status-pill ' + status.tone}>{status.label}</span></div>
                <h3>{p.name}</h3>
                <p className="project-channel">{meta.channels.find(c => c.id === p.channel)?.name || '尚未选择渠道'}{p.durationSec ? ' · ' + p.durationSec + ' 秒' : ''}</p>
                <div className="mini-progress" aria-label={'当前阶段：' + phase.name}>{PHASES.map(ph => <span key={ph.id} className={p.finalVideo || ph.id <= p.phase ? 'filled' : ''} />)}</div>
                <div className="project-card-footer"><span>{p.shotCount} 个镜头 <span className="mx-1">·</span> {formatDate(p.updatedAt)} 更新</span><span className="project-open">{p.finalVideo ? '查看成片' : phase.name}<Icon name="arrow" width="15" /></span></div>
              </button>
            })}
            {!search && filter !== 'finished' && <button className="new-project-card" onClick={onCreate} disabled={busy}><span><Icon name="plus" width="26" height="26" /></span><strong>开始新的创意</strong><p>从一个投放需求出发</p></button>}
          </div> : <div className="project-empty"><Icon name="search" width="28" height="28" /><h3>{search ? '没有找到匹配的项目' : filter === 'finished' ? '还没有生成成片' : '这里还没有项目'}</h3><p>{search ? '试试其他名称，或清空搜索条件。' : filter === 'finished' ? '完成镜头生成与审核后，即可合成第一条广告。' : '新建一个素材项目，开始你的创作。'}</p><button className="btn-ghost mt-4" onClick={search || filter !== 'all' ? () => { setSearch(''); setFilter('all') } : onCreate}>{search || filter !== 'all' ? '查看全部项目' : '新建素材项目'}</button></div>}
        </section>
        <aside className="overview-aside">
          <section className="film-panel">
            <div className="section-heading"><div><h2>最近成片</h2><p>把创意变成看得见的作品</p></div><span className="small-label">PREVIEW</span></div>
            {latestFilm ? <>
              <div className="film-stage"><video src={latestFilm.finalVideo!} controls playsInline preload="metadata" poster={latestFilm.cover || undefined} aria-label={latestFilm.name + '成片预览'} /></div>
              <h3>{latestFilm.name}</h3><div className="flex items-center justify-between gap-3"><span className="text-xs text-slate-500">{latestFilm.shotCount} 个镜头 · {latestFilm.durationSec || '—'} 秒</span><button className="text-link" onClick={() => onOpen(latestFilm.id, 6)} disabled={busy}>查看作品 <Icon name="arrow" width="14" /></button></div>
            </> : <div className="film-empty"><Icon name="movie" width="32" height="32" /><p>你的第一条广告，即将从这里诞生。</p></div>}
          </section>
          <div className="studio-note"><Icon name="check" width="18" /><div><strong>好创意，也要有依据</strong><p>产品事实绑定、文案合规检查与自动审核，贯穿每一次创作。</p></div></div>
        </aside>
      </div>
      <section className="journey-panel">
        <div className="section-heading"><div><h2>一条清晰的创作路径</h2><p>每一步都可回看、调整，再继续。</p></div><span className="small-label">WORKFLOW</span></div>
        <div className="journey-grid">{PHASES.map(ph => <div className="journey-step" key={ph.id}><span>{'0' + ph.id}</span><h3>{ph.name}</h3><p>{ph.desc}</p></div>)}</div>
      </section>
      <footer className="studio-footer"><span>花小猪 · AI 广告创意工作台</span><span>让每一次创意，都有清晰的下一步。</span></footer>
    </div>
  )
}