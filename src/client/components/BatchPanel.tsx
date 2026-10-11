import { useEffect, useState } from 'react'
import type { CreativeBatch, Project } from '../types'
import { api } from '../api'
import { Badge, Section, Spinner } from '../ui'

const steps: Record<string, string> = { storyboard: '生成分镜', review: '自动审核', render: '生成镜头', poll: '等待镜头', assemble: '合成成片', quality: '成片质检' }
export default function BatchPanel({ project, phase, onOpen, onUpdate, notify, onTests }: { project: Project; phase: number; onOpen: (id: string, phase?: number) => void; onUpdate: (project: Project) => void; notify: (message: string, tone?: 'error' | 'ok') => void; onTests: () => void }) {
  const root = project.batchId || project.id
  const [batch, setBatch] = useState<CreativeBatch | undefined>(project.batch)
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setBatch(project.batch) }, [project.batch])
  useEffect(() => { setSelected(project.batch?.items.map(i => i.id) || []) }, [root, project.batch?.items.length])
  useEffect(() => {
    let cancelled = false, timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const next = await api.batch(root)
        if (cancelled) return
        setBatch(next)
        if (next.job?.status === 'running') timer = setTimeout(tick, 2500)
        else if (batch?.job?.status === 'running') onUpdate(await api.getProject(project.id))
      } catch (e: any) { if (!cancelled) setError(e.message) }
    }
    void tick()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [root, batch?.job?.id, batch?.job?.status, project.id])
  if (!batch) return null
  const running = batch.job?.status === 'running'
  const complete = batch.items.filter(i => i.videoUrl && !i.stale).length
  const action = phase === 4 ? 'storyboard' : phase === 5 ? 'review' : 'produce'
  const run = async (ids = selected) => {
    setBusy(true); setError('')
    try { const job = await api.runBatch(root, ids, action); setBatch({ ...batch, job }); notify('批量任务已启动，切换页面后仍会继续执行') }
    catch (e: any) { setError(e.message); notify(e.message, 'error') } finally { setBusy(false) }
  }
  return <Section title="本批视频素材" desc="共享品牌和投放需求，每条素材独立制作。可批量推进，也可打开单条修改；已完成的镜头会保留。" right={<Badge tone="brand">{batch.items.length} 条素材</Badge>}>
    <div className="batch-stats"><div><strong>{batch.target}</strong><span>计划交付</span></div><div><strong>{batch.items.length}</strong><span>已建素材</span></div><div><strong>{complete}</strong><span>已有当前成片</span></div><div><strong>{batch.items.filter(i => i.qualityStatus === 'passed' && !i.stale).length}</strong><span>成片质检通过</span></div></div>
    <div className="batch-toolbar"><button className="btn-primary" disabled={running || busy || !selected.length} onClick={() => void run()}>{busy && <Spinner />}{action === 'produce' ? '批量制作并质检' : action === 'review' ? '批量自动审核' : '批量生成分镜'} · {selected.length} 条</button>
      {running && <button className="btn-ghost" disabled={busy} onClick={async () => { setBusy(true); try { await api.pauseBatch(root); notify('当前步骤结束后暂停，已有内容保留') } catch (e: any) { notify(e.message, 'error') } finally { setBusy(false) } }}>暂停批量任务</button>}
      {complete > 0 && <a className="btn-ghost" href={`/api/projects/${root}/batch/delivery.zip`} download>下载本批已完成成片</a>}
      <button className="btn-ghost" onClick={onTests}>选素材做测试 →</button>
    </div>
    {running && <p className="business-help" role="status"><Spinner /> 正在处理 {batch.job?.items.filter(i => i.status === 'done').length}/{batch.job?.items.length} 条；为避免重复提交，编辑将在暂停或处理结束后开放。</p>}
    {error && <p role="alert" className="inspiration-error">{error}</p>}
    {batch.job?.message && <p className="business-help">{batch.job.message}</p>}
    <details className="batch-list" open={phase === 6 || !project.storyboard || undefined}><summary>查看与选择 {batch.items.length} 条素材 · 当前：{batch.items.find(i => i.id === project.id)?.name}</summary>
      <div className="batch-toolbar"><button className="text-link" onClick={() => setSelected(batch.items.map(i => i.id))}>全选</button><button className="text-link" onClick={() => setSelected([])}>清空选择</button></div>
      <div className="batch-grid">{batch.items.map((item, index) => {
        const job = batch.job?.items.find(i => i.id === item.id)
        return <article className={'batch-card ' + (project.id === item.id ? 'is-current' : '')} key={item.id}>
          <div className="batch-card-heading"><label><input type="checkbox" checked={selected.includes(item.id)} onChange={e => setSelected(e.target.checked ? [...selected, item.id] : selected.filter(id => id !== item.id))} /><span>素材 {String(index + 1).padStart(2, '0')}</span></label><Badge tone={item.videoUrl && !item.stale ? 'green' : 'slate'}>{item.stale ? '待更新' : item.videoUrl ? '已有成片' : item.shotCount ? `${item.readyShots}/${item.shotCount} 镜就绪` : '待分镜'}</Badge></div>
          {item.cover && <img className="batch-cover" src={item.cover} alt={item.name} />}
          <strong>{item.name}</strong><p>{job?.status === 'running' ? steps[job.step] || '准备中' : job?.message || (item.approved ? '自动审核通过' : '完成分镜后自动审核')}</p>
          {job?.status === 'attention' && <span className="batch-attention">需处理</span>}
          <div className="batch-toolbar"><button className="btn-ghost" onClick={() => onOpen(item.id, phase)}>打开这条素材</button>{job?.status === 'attention' && !running && <button className="text-link" disabled={busy} onClick={() => void run([item.id])}>仅重试这条</button>}</div>
        </article>
      })}</div>
    </details>
    {action === 'produce' && <p className="business-help">按“分镜 → 自动审核 → 镜头生成 → 合成 → 成片质检”逐条处理；调用已配置模型会使用对应服务额度，已完成步骤自动跳过。</p>}
  </Section>
}
