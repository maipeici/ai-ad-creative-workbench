import { useEffect, useRef, useState } from 'react'
import type { CreativeBatch, CreativeSummary, Project } from '../types'
import { api } from '../api'
import { Badge, Modal, Spinner } from '../ui'

const steps: Record<string, string> = { storyboard: '准备版本脚本', review: '自动审核', render: '生成镜头', poll: '等待镜头', assemble: '合成成片', quality: '成片质检' }
const stageOf = (i: CreativeSummary) => !i.shotCount ? 4 : !i.approved && !i.videoUrl ? 5 : 6
const statusOf = (i: CreativeSummary) => i.stale ? '成片待更新' : i.videoUrl ? i.qualityStatus === 'passed' ? '质检通过' : '待成片质检' : !i.shotCount ? '待准备脚本' : !i.approved ? '待自动审核' : '可生成视频'
type Props = {
  project: Project; phase: number; production?: boolean; ffmpeg?: boolean
  onOpen: (id: string, phase?: number) => Promise<boolean | void>
  onUpdate: (project: Project) => void
  notify: (message: string, tone?: 'error' | 'ok') => void
  beforeOpen: () => Promise<void>
  onExperiment?: () => void
}

export default function BatchPanel({ project, phase, production, ffmpeg, onOpen, onUpdate, notify, beforeOpen, onExperiment }: Props) {
  const root = project.batchId || project.id
  const [batch, setBatch] = useState<CreativeBatch | undefined>(project.batch)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const wasRunning = useRef(false)
  const updateRef = useRef(onUpdate)
  updateRef.current = onUpdate
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
        if (finished) { const fresh = await api.getProject(project.id); if (!cancelled) updateRef.current(fresh) }
        if (!cancelled && next.job?.status === 'running') timer = setTimeout(tick, 2500)
      } catch (e: any) { if (!cancelled) setError(e.message) }
    }
    void tick()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [root, project.id, open, running])
  if (!batch) return null
  if (!production && (batch.items.length < 2 || phase < 4) && !running) return null
  const complete = batch.items.filter(i => i.videoUrl && !i.stale).length
  const attention = new Set(batch.job?.items.filter(i => ['attention', 'paused'].includes(i.status)).map(i => i.id))
  const action = production ? 'produce' : phase === 5 ? 'review' : 'storyboard'
  const eligible = batch.items.filter(i => action === 'storyboard' ? !i.shotCount || i.scriptSource?.startsWith('mock') : action === 'review' ? i.shotCount && !i.approved : i.shotCount && i.approved && (!i.videoUrl || i.stale || i.qualityStatus !== 'passed'))
  const selectedIds = selected.filter(id => batch.items.some(i => i.id === id))
  const runIds = selectedIds.length ? selectedIds.filter(id => eligible.some(i => i.id === id)) : eligible.map(i => i.id)
  const visible = batch.items.filter(i => filter === 'all' || filter === 'storyboard' && !i.shotCount || filter === 'review' && i.shotCount && !i.approved || filter === 'produce' && i.approved && (!i.videoUrl || i.stale) || filter === 'complete' && i.videoUrl && !i.stale || filter === 'attention' && attention.has(i.id))
  const openItem = async (item: CreativeSummary, target = stageOf(item)) => { if (await onOpen(item.id, target) !== false) setOpen(false) }
  const run = async (ids = runIds) => {
    setBusy(true); setError('')
    try {
      await beforeOpen()
      const job = await api.runBatch(root, ids, action)
      wasRunning.current = true; setBatch({ ...batch, job })
      notify(production ? '批量视频任务已启动，完成的镜头会保留' : '任务已启动，可在此查看各版本进度')
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }
  const content = <>
    {production && <div className="production-heading"><div><div className="eyebrow">ONE IDEA · MULTIPLE VIDEOS</div><h2>一条创意，批量生成 {batch.items.length} 条视频</h2><p>{project.versionPlan?.concept.title || project.concepts.find(c => c.id === project.selectedConceptId)?.title || '先确定核心创意'}{project.versionPlan ? ` · ${project.versionPlan.hookStrategy}` : ''}</p></div><button className="btn-ghost" onClick={() => void onOpen(root, 4)}>设置脚本与版本数量 →</button></div>}
    {production && <div className="batch-stats"><div><strong>{batch.items.length}</strong><span>视频版本</span></div><div><strong>{batch.items.filter(i => i.shotCount && i.approved).length}</strong><span>脚本审核通过</span></div><div><strong>{complete}</strong><span>已有当前成片</span></div><div><strong>{batch.items.filter(i => i.qualityStatus === 'passed' && !i.stale).length}</strong><span>成片质检通过</span></div></div>}
    <div className="production-actions"><div><button className="btn-primary" disabled={busy || running || !runIds.length || production && !ffmpeg} onClick={() => void run()}>{busy && <Spinner />}{running ? '正在处理视频版本…' : action === 'produce' ? (runIds.length ? `批量生成 ${runIds.length} 条视频` : '批量生成视频') : action === 'review' ? `自动审核 ${runIds.length} 个版本` : `准备 ${runIds.length} 个版本脚本`}</button>{running && <button className="btn-ghost" onClick={async () => { try { await api.pauseBatch(root); notify('当前步骤结束后暂停，已有内容保留') } catch (e: any) { setError(e.message) } }}>暂停任务</button>}</div><p>{production ? '为审核通过的版本依次生成镜头、自动加入字幕与配音、合成完整视频并质检。已有成果会复用，单条失败不影响其他版本。' : action === 'review' ? '只审核已准备好的脚本：品牌要求、平台规则，以及与基础创意的一致性。' : '按照共用框架和允许变化项准备脚本。已有脚本保留，可切换版本逐条编辑。'}使用已配置的模型额度。</p></div>
    {production && !ffmpeg && <p className="foundation-notice" role="status">视频合成待配置：需先配置 FFmpeg，才能开始批量制作完整视频。</p>}
    {production && batch.items.some(i => !i.shotCount || !i.approved) && <div className="production-prerequisites"><span>{batch.items.filter(i => !i.shotCount).length} 个版本待准备脚本 · {batch.items.filter(i => i.shotCount && !i.approved).length} 个待自动审核</span><button className="text-link" onClick={() => void onOpen(root, 4)}>准备脚本 →</button><button className="text-link" onClick={() => void onOpen(root, 5)}>自动审核 →</button></div>}
    {!production && action === 'review' && batch.items.some(i => !i.shotCount) && <p className="business-help">尚无脚本的版本需要先回分镜规划准备。<button className="text-link" onClick={() => void onOpen(root, 4)}>前往分镜 →</button></p>}
    {error && <p role="alert" className="inspiration-error">{error}</p>}
    {batch.job?.message && <p role="status" className="business-help">{batch.job.message}</p>}
    <div className="material-filters" aria-label="筛选版本状态">{[['all','全部版本'],['storyboard','待脚本'],['review','待审核'],['produce','待制作'],['attention','需处理'],['complete','已有成片']].map(([value,label]) => <button key={value} className={filter === value ? 'chip-on' : 'chip-off'} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
    <div className="batch-toolbar"><button className="text-link" onClick={() => setSelected(visible.map(i => i.id))}>选择当前列表</button><button className="text-link" onClick={() => setSelected([])}>清空选择</button><span>{selectedIds.length ? `已选 ${selectedIds.length} 个，${runIds.length} 个可执行` : '默认处理所有可执行版本'}</span></div>
    {!visible.length && <p className="business-empty">当前筛选下没有版本。</p>}
    <div className={production ? 'video-version-grid' : 'material-rows'}>{visible.map(item => {
      const job = batch.job?.items.find(i => i.id === item.id)
      const problem = job?.status === 'attention' || job?.status === 'paused'
      return <article className={production ? 'video-version-card' : 'material-row'} key={item.id}>
        {production && <div className="video-version-preview">{item.videoUrl ? <video src={item.videoUrl} poster={item.cover || undefined} preload="none" controls playsInline /> : <div><span>{String(batch.items.findIndex(i => i.id === item.id) + 1).padStart(2, '0')}</span><strong>{job?.status === 'running' ? steps[job.step] || '准备中' : statusOf(item)}</strong><small>{item.shotCount ? `${item.readyShots} / ${item.shotCount} 个镜头已就绪` : '脚本准备后可查看镜头进度'}</small></div>}</div>}
        <label className="material-row-name"><input type="checkbox" aria-label={'选择版本：' + item.name} checked={selectedIds.includes(item.id)} onChange={e => setSelected(e.target.checked ? [...selectedIds, item.id] : selectedIds.filter(id => id !== item.id))} /><span><strong>{item.name}</strong>{!production && <small>{item.shotCount ? `${item.shotCount} 个镜头 · ${statusOf(item)}` : '尚未准备脚本'}</small>}</span></label>
        <Badge tone={problem ? 'amber' : item.qualityStatus === 'passed' ? 'green' : 'slate'}>{job?.status === 'running' ? steps[job.step] || '准备中' : problem ? '需处理' : statusOf(item)}</Badge>
        {item.instruction && <details className="version-instruction"><summary>本版本变化要求</summary><p>{item.instruction}</p></details>}
        <div className="version-card-actions"><button className="btn-ghost" onClick={() => void openItem(item, production ? stageOf(item) : phase)}>{production ? stageOf(item) === 4 ? '准备此版脚本' : stageOf(item) === 5 ? '处理此版审核' : '查看成片与镜头' : '打开此版本'}</button>{production && item.videoUrl && <a className="text-link" href={item.videoUrl} download>下载{item.stale ? '旧版' : '成片'}</a>}{problem && !running && eligible.some(i => i.id === item.id) && <button className="text-link" disabled={busy || production && !ffmpeg} onClick={() => void run([item.id])}>继续此版本</button>}</div>
        {problem && job?.message && <p className="material-row-message">{job.message}</p>}
      </article>
    })}</div>
    {production && complete > 0 && <div className="delivery-actions"><div><strong>{complete} 条成片可交付</strong><p>需要验证投放效果时，选择版本建立测试并导入投放数据。</p></div><div className="batch-toolbar"><a className="btn-ghost" href={`/api/projects/${root}/batch/delivery.zip`} download>下载本批成片 ZIP</a><button className="btn-primary" onClick={onExperiment}>进入素材测试 →</button></div></div>}
  </>
  if (production) return <section className="production-board" aria-label="批量视频制作">{content}</section>
  return <><div className="project-material-bar"><span>同一创意 · {batch.items.length} 个视频版本</span><label className="material-switcher"><span>当前版本</span><select aria-label="切换当前版本" value={project.id} onChange={e => { const item = batch.items.find(i => i.id === e.target.value); if (item) void openItem(item, phase) }}>{batch.items.map((item, i) => <option key={item.id} value={item.id}>{String(i + 1).padStart(2, '0')} · {item.name}</option>)}</select></label>{running && <span className="material-running"><Spinner />处理中</span>}<button className="btn-ghost" onClick={async () => { try { await beforeOpen(); setBatch(await api.batch(root)); setOpen(true) } catch (e: any) { notify(e.message, 'error') } }}>{phase === 5 ? '批量审核' : '版本脚本'}</button></div><Modal open={open} drawer title={phase === 5 ? '各版本自动审核' : '准备各版本脚本'} onClose={() => setOpen(false)}>{content}</Modal></>
}
