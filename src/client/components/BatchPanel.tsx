import { useEffect, useRef, useState } from 'react'
import type { CreativeBatch, CreativeSummary, Project } from '../types'
import { api } from '../api'
import { Badge, Modal, Spinner } from '../ui'

const steps: Record<string, string> = { storyboard: '生成分镜', review: '自动审核', render: '生成镜头', poll: '等待镜头', assemble: '合成成片', quality: '成片质检' }
const stageOf = (item: CreativeSummary) => !item.shotCount ? 4 : !item.approved && !item.videoUrl ? 5 : 6
const statusOf = (item: CreativeSummary) => item.stale ? '成片待更新' : item.videoUrl ? item.qualityStatus === 'passed' ? '质检通过' : '待成片质检' : !item.shotCount ? '待分镜' : !item.approved ? '待自动审核' : '待制作成片'
type Props = {
  project: Project; phase: number
  onOpen: (id: string, phase?: number) => Promise<boolean | void>
  onUpdate: (project: Project) => void
  notify: (message: string, tone?: 'error' | 'ok') => void
  beforeOpen: () => Promise<void>
}

// Keep batch management at project level; stage pages only edit the selected material.
export default function BatchPanel({ project, phase, onOpen, onUpdate, notify, beforeOpen }: Props) {
  const root = project.batchId || project.id
  const [batch, setBatch] = useState<CreativeBatch | undefined>(project.batch)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [filter, setFilter] = useState('all')
  const [action, setAction] = useState<'storyboard' | 'review' | 'produce'>('storyboard')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const wasRunning = useRef(false)
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate
  useEffect(() => { setBatch(project.batch) }, [project.batch])
  useEffect(() => { setSelected([]); setOpen(false); setFilter('all'); setError(''); wasRunning.current = false }, [root])
  const running = batch?.job?.status === 'running'
  useEffect(() => {
    let cancelled = false, timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const next = await api.batch(root)
        if (cancelled) return
        const finished = wasRunning.current && next.job?.status !== 'running'
        wasRunning.current = next.job?.status === 'running'
        setBatch(next)
        if (finished) {
          const fresh = await api.getProject(project.id)
          if (!cancelled) onUpdateRef.current(fresh)
        }
        if (!cancelled && next.job?.status === 'running') timer = setTimeout(tick, 2500)
      } catch (e: any) { if (!cancelled) setError(e.message) }
    }
    void tick()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [root, project.id, open, running])
  if (!batch) return null
  const multiple = batch.items.length > 1
  const complete = batch.items.filter(i => i.videoUrl && !i.stale).length
  const current = batch.items.find(i => i.id === project.id)
  const attention = new Set(batch.job?.items.filter(i => ['attention', 'paused'].includes(i.status)).map(i => i.id))
  if (!multiple && phase < 4 && !running && attention.size === 0) return null
  const visible = batch.items.filter(i => filter === 'all' || filter === 'storyboard' && !i.shotCount || filter === 'review' && i.shotCount && !i.approved || filter === 'produce' && i.approved && (!i.videoUrl || i.stale) || filter === 'complete' && i.videoUrl && !i.stale || filter === 'attention' && attention.has(i.id))
  const selectedIds = selected.filter(id => batch.items.some(i => i.id === id))
  const openManager = async () => {
    try {
      await beforeOpen()
      setBatch(await api.batch(root))
      setAction(phase === 5 ? 'review' : phase === 6 ? 'produce' : 'storyboard')
      setOpen(true)
    } catch (e: any) { notify(e.message, 'error') }
  }
  const openItem = async (item: CreativeSummary, target = stageOf(item)) => {
    if (await onOpen(item.id, target) !== false) setOpen(false)
  }
  const run = async (ids = selectedIds, stage = action) => {
    setBusy(true); setError('')
    try {
      await beforeOpen()
      const job = await api.runBatch(root, ids, stage)
      wasRunning.current = true; setBatch({ ...batch, job })
      notify('任务已启动，关闭面板后仍会继续执行')
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }
  return <>
    <div className="project-material-bar" aria-label="当前素材与整批管理">
      {multiple ? <span>本项目 {batch.items.length} 条素材</span> : <span>{phase >= 4 ? '当前素材：' + (current?.name || '未命名') : '本项目共用品牌与投放需求'}</span>}
      {multiple && phase >= 4 && <label className="material-switcher"><span>当前素材</span><select aria-label="切换当前素材" value={project.id} onChange={e => { const item = batch.items.find(i => i.id === e.target.value); if (item) void openItem(item, phase) }}>{batch.items.map((item, i) => <option key={item.id} value={item.id}>{String(i + 1).padStart(2, '0')} · {item.name}</option>)}</select></label>}
      {running && <span className="material-running" role="status"><Spinner /> 处理中 {batch.job?.items.filter(i => i.status === 'done').length}/{batch.job?.items.length}</span>}
      {(multiple || running || attention.size > 0) && <button className="btn-ghost" onClick={() => void openManager()}>{running ? '查看批量进度' : '查看本批素材'}</button>}
    </div>
    <Modal open={open} drawer title="本批素材管理" onClose={() => setOpen(false)}>
      <p className="business-help">{batch.name} · 在这里查看整批进度和执行批量操作；关闭后继续当前素材。</p>
      {multiple && <div className="batch-stats mt-4"><div><strong>{batch.target}</strong><span>计划交付</span></div><div><strong>{batch.items.length}</strong><span>已建素材</span></div><div><strong>{complete}</strong><span>已有成片</span></div><div><strong>{batch.items.filter(i => i.qualityStatus === 'passed' && !i.stale).length}</strong><span>质检通过</span></div></div>}
      <div className="material-filters" aria-label="筛选素材状态">{[['all','全部'],['storyboard','待分镜'],['review','待审核'],['produce','待制作'],['attention','需处理'],['complete','已有成片']].map(([value,label]) => <button key={value} className={filter === value ? 'chip-on' : 'chip-off'} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
      <div className="material-actions">
        <div className="batch-toolbar"><button className="text-link" onClick={() => setSelected(visible.map(i => i.id))}>选择当前列表</button><button className="text-link" onClick={() => setSelected([])}>清空</button><span>已选 {selectedIds.length} 条</span></div>
        <div className="batch-toolbar"><select className="input" aria-label="批量操作" value={action} disabled={busy || running} onChange={e => setAction(e.target.value as typeof action)}><option value="storyboard">生成分镜</option><option value="review">自动审核</option><option value="produce">制作并质检</option></select><button className="btn-primary" disabled={busy || running || !selectedIds.length} onClick={() => void run()}>{busy && <Spinner />}执行{multiple ? '批量操作' : '操作'}</button>
          {running && <button className="btn-ghost" disabled={busy} onClick={async () => { try { await api.pauseBatch(root); notify('当前步骤结束后暂停，已有内容保留') } catch (e: any) { setError(e.message) } }}>暂停任务</button>}
        </div>
      </div>
      <p className="business-help">{action === 'storyboard' ? '为所选素材补齐分镜，已有分镜会保留。' : action === 'review' ? '为所选素材补齐分镜并完成审核，已通过的步骤会跳过。' : '依次完成分镜、审核、镜头、合成和质检，已有成果会复用。'}使用已配置的模型额度，单条失败不影响其余素材。</p>
      {error && <p role="alert" className="inspiration-error">{error}</p>}
      {batch.job?.message && <p role="status" className="business-help">{batch.job.message}</p>}
      {!visible.length && <p className="business-empty">当前筛选下没有素材。</p>}
      <div className="material-rows">{visible.map(item => {
        const job = batch.job?.items.find(i => i.id === item.id)
        return <article className={'material-row ' + (project.id === item.id ? 'is-current' : '')} key={item.id}>
          <label className="material-row-name"><input type="checkbox" aria-label={'选择素材：' + item.name} checked={selectedIds.includes(item.id)} onChange={e => setSelected(e.target.checked ? [...selectedIds, item.id] : selectedIds.filter(id => id !== item.id))} /><span><strong>{item.name}</strong><small>{item.shotCount ? `${item.readyShots}/${item.shotCount} 镜已就绪` : '尚未生成分镜'}{project.id === item.id ? ' · 当前素材' : ''}</small></span></label>
          <Badge tone={job?.status === 'attention' ? 'amber' : item.qualityStatus === 'passed' ? 'green' : 'slate'}>{job?.status === 'running' ? steps[job.step] || '准备中' : job?.status === 'attention' ? '需处理' : statusOf(item)}</Badge>
          <button className="btn-ghost" onClick={() => void openItem(item)}>{stageOf(item) === 4 ? '编辑分镜' : stageOf(item) === 5 ? '查看审核' : '查看制作'}</button>
          {job?.message && <p className="material-row-message">{job.message}</p>}
          {job?.status === 'attention' && !running && <button className="text-link material-retry" disabled={busy} onClick={() => void run([item.id], batch.job!.stage as typeof action)}>重试这条{batch.job?.stage === 'storyboard' ? '分镜' : batch.job?.stage === 'review' ? '审核' : '制作'}</button>}
        </article>
      })}</div>
      {complete > 0 && <div className="batch-toolbar material-download"><span>{complete} 条当前成片可下载</span><a className="btn-ghost" href={`/api/projects/${root}/batch/delivery.zip`} download>下载本批成片 ZIP</a></div>}
    </Modal>
  </>
}
