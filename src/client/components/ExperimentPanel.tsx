import { useEffect, useState } from 'react'
import { api } from '../api'
import type { ExperimentReport, Project, ProjectSummary } from '../types'
import { Badge, Field, Section, Spinner } from '../ui'

type Props = { project: Project | null; projects: ProjectSummary[]; notify: (message: string, tone?: 'error' | 'ok') => void; onOpen: (id: string, phase?: number) => void; onUpdate: (project: Project) => void }
const metricNames: Record<string, string> = { ctr: '点击率 CTR', cvr: '点击转化率 CVR', cpa: '转化成本 CPA' }
const variableNames: Record<string, string> = { hook: '开头内容', cta: '结尾行动引导' }
const display = (value: number | null, metric: string) => value === null ? '—' : metric === 'cpa' ? '¥' + value.toFixed(2) : (value * 100).toFixed(2) + '%'

export default function ExperimentPanel({ project, projects, notify, onOpen, onUpdate }: Props) {
  const [items, setItems] = useState<ExperimentReport[]>([])
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ title: '', variable: 'hook', hypothesis: '', primaryMetric: 'ctr', audience: '', budget: '', period: '', attribution: '点击后 7 天；仅统计点击归因转化', trafficMethod: 'observational' })
  const [versionForm, setVersionForm] = useState({ vo: '', subtitle: '', actionCn: '', instruction: '' })
  const [showVersion, setShowVersion] = useState(false)
  const [csv, setCsv] = useState('')
  const [conclusion, setConclusion] = useState('')
  const [nextAction, setNextAction] = useState('')
  const current = items.find(e => e.id === selected)
  const refresh = async (id?: string) => {
    const data = await api.experiments(); setItems(data)
    setSelected(previous => id || (data.some(e => e.id === previous) ? previous : data.find(e => e.parentId === (project?.experimentLink?.parentId || project?.id))?.id || data[0]?.id || ''))
  }
  useEffect(() => { void refresh().catch(e => setError(e.message)) }, [project?.id])
  useEffect(() => { setConclusion(current?.conclusion || ''); setNextAction(current?.nextAction || ''); setShowVersion(false); setCsv('') }, [selected])
  const run = async (name: string, work: () => Promise<void>) => {
    if (busy) return
    setBusy(name); setError('')
    try { await work() } catch (e: any) { setError(e.message); notify(e.message, 'error') } finally { setBusy('') }
  }
  const sourceId = project?.experimentLink?.parentId || project?.id
  return <div className="business-page">
    <div className="business-heading"><div><p className="eyebrow">CREATIVE EXPERIMENTS</p><h1>实验复盘</h1><p>先定义要验证的变化，再制作可比较的版本，把投放结果带回下一次创作。</p></div>
      <button className="btn-primary" disabled={!project || !!project.experimentLink || !!busy} onClick={() => setShowCreate(!showCreate)}>建立素材实验</button></div>
    <div className="business-flow"><span>01 定义假设</span><span>02 制作 A 基准版</span><span>03 改写并制作 B 版</span><span>04 导出与投放</span><span>05 导入结果复盘</span></div>
    <Section title="当前推广任务" desc="一个实验只改变一个镜头的内容；受众、活动、时长、音色和其他镜头保持一致。">
      <select className="input" aria-label="实验所属任务" value={sourceId || ''} onChange={e => onOpen(e.target.value, 7)}><option value="" disabled>选择一个已有任务</option>{projects.filter(p => !p.experimentLink).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      {!project?.storyboard && <p className="business-help">先确定创意并生成基准分镜，即可建立实验。可在需求补充说明中提前记录测试想法。</p>}
    </Section>
    {showCreate && project && <Section title="实验设计" desc="这里只记录计划；实际分流和投放在广告平台执行。">
      <div className="business-form-grid">
        <Field label="实验名称"><input className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="例如：通勤广告开头对比" /></Field>
        <Field label="本次变化变量"><select className="input" value={form.variable} onChange={e => setForm({ ...form, variable: e.target.value })}>{Object.entries(variableNames).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
        <Field label="主要判断指标"><select className="input" value={form.primaryMetric} onChange={e => setForm({ ...form, primaryMetric: e.target.value })}>{Object.entries(metricNames).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
        <Field label="实验假设"><textarea className="input" value={form.hypothesis} onChange={e => setForm({ ...form, hypothesis: e.target.value })} placeholder="例如：具体出行困境比泛泛提问更容易吸引点击" /></Field>
        <Field label="固定人群"><input className="input" value={form.audience} onChange={e => setForm({ ...form, audience: e.target.value })} placeholder={project.brief.audience} /></Field>
        <Field label="预算与分配计划"><input className="input" value={form.budget} onChange={e => setForm({ ...form, budget: e.target.value })} placeholder="例如：两组相同预算" /></Field>
        <Field label="测试时间计划"><input className="input" value={form.period} onChange={e => setForm({ ...form, period: e.target.value })} placeholder="例如：同一周、相同投放时段" /></Field>
        <Field label="归因口径"><input className="input" value={form.attribution} onChange={e => setForm({ ...form, attribution: e.target.value })} /></Field>
        <Field label="投放分流方式"><select className="input" value={form.trafficMethod} onChange={e => setForm({ ...form, trafficMethod: e.target.value })}><option value="observational">常规投放 · 观察性比较</option><option value="platform-split">计划使用广告平台拆分测试</option></select></Field>
      </div><button className="btn-primary mt-4" disabled={!!busy || !project.storyboard || !form.hypothesis.trim()} onClick={() => run('create', async () => { const result = await api.createExperiment(project.id, form); onUpdate(result.project); await refresh(result.experiment.id); setShowCreate(false); notify('实验已建立，A 基准快照已保存') })}>{busy === 'create' && <Spinner />}保存实验与基准版</button>
    </Section>}
    {error && <p role="alert" className="inspiration-error">{error}</p>}
    {items.length > 0 ? <>
      <div className="business-selector">{items.map(e => <button className={selected === e.id ? 'chip-on' : 'chip-off'} key={e.id} onClick={() => setSelected(e.id)} disabled={!!busy}>{e.parentName} · {e.title}</button>)}</div>
      {current && <>
        <Section title={current.title} desc={current.hypothesis} right={<Badge tone="blue">{variableNames[current.variable]} · {metricNames[current.primaryMetric]}</Badge>}>
          <p className="business-help">只改镜头 #{current.editableShotIndex} 的内容，保留时长与素材引用。B 版复用 A 版其余已生成镜头。每个版本拥有独立脚本、审核、视频与导出文件。</p>
          <div className="experiment-versions">{current.versions.map(v => <article className="experiment-version" key={v.projectId}>
            <div className="flex justify-between items-center"><strong>{v.label} · {v.name}</strong><Badge tone={v.videoUrl && !v.staleVideo ? 'green' : 'amber'}>{v.staleVideo ? '成片待更新' : v.videoUrl ? '已有成片' : `${v.readyShots}/${v.shotCount} 镜就绪`}</Badge></div>
            {v.videoUrl ? <video src={v.videoUrl} poster={v.cover || undefined} controls preload="metadata" /> : <div className="experiment-video-empty">{v.label === 'A' ? '制作基准版后，再创建实验版' : '固定镜头已复用，只需完成变化镜头'}</div>}
            <button className="btn-ghost" disabled={!v.available} onClick={() => onOpen(v.projectId, v.videoUrl ? 6 : 4)}>打开 {v.label} 版制作</button>
          </article>)}</div>
          <div className="flex flex-wrap gap-3 mt-4"><button className="btn-primary" disabled={!!busy || current.versions.length >= 6 || !current.versions[0].videoUrl || current.versions[0].staleVideo} onClick={() => run('prepare', async () => { const baseline = await api.getProject(current.versions[0].projectId); const shot = baseline.storyboard!.shots.find(s => s.id === current.editableShotId)!; setVersionForm({ vo: shot.vo || '', subtitle: shot.subtitle || '', actionCn: shot.actionCn || '', instruction: '' }); setShowVersion(true) })}>新增实验版</button>
            {current.versions.length > 1 && current.versions.every(v => v.videoUrl && !v.staleVideo) && <a className="btn-ghost" href={`/api/projects/${current.parentId}/experiments/${current.id}/delivery.zip`} download>下载整组投放交付包</a>}</div>
          {showVersion && <div className="experiment-editor"><p>手动改写本镜画面和文案，或填写要求让 AI 改写本镜；其他镜头保持锁定。</p>
            <div className="business-form-grid"><Field label="本镜画面"><textarea aria-label="本镜画面" className="input" value={versionForm.actionCn} onChange={e => setVersionForm({ ...versionForm, actionCn: e.target.value })} /></Field><Field label="本镜口播"><textarea className="input" value={versionForm.vo} onChange={e => setVersionForm({ ...versionForm, vo: e.target.value })} /></Field><Field label="本镜字幕"><input className="input" value={versionForm.subtitle} onChange={e => setVersionForm({ ...versionForm, subtitle: e.target.value })} /></Field></div>
            <div className="flex gap-2 mt-3"><button className="btn-primary" disabled={!!busy} onClick={() => run('version', async () => { const result = await api.experimentVersion(current.parentId, current.id, { changes: { vo: versionForm.vo, subtitle: versionForm.subtitle, actionCn: versionForm.actionCn } }); onUpdate(result.project); await refresh(current.id); setShowVersion(false); notify('实验版已建立，固定镜头已复用') })}>保存实验版</button><button className="btn-ghost" onClick={() => setShowVersion(false)}>取消</button></div>
            <Field label="AI 改写要求"><input className="input mt-3" value={versionForm.instruction} onChange={e => setVersionForm({ ...versionForm, instruction: e.target.value })} placeholder="例如：开头改为第一人称讲述晚高峰困境" /></Field>
            <button className="btn-ghost mt-3" disabled={!!busy || !versionForm.instruction.trim()} onClick={() => run('ai', async () => { const result = await api.experimentVersion(current.parentId, current.id, { mode: 'ai', instruction: versionForm.instruction }); onUpdate(result.project); await refresh(current.id); setShowVersion(false) })}>{busy === 'ai' && <Spinner />}AI 生成实验版</button>
          </div>}
        </Section>
        <Section title="投放结果与复盘" desc="上传广告后台导出的同口径数据。此处计算描述性指标，不自动认定因果关系或统计显著性。">
          <div className="business-flow"><span>人群：{current.plan.audience}</span><span>预算：{current.plan.budget || '未填写'}</span><span>周期：{current.plan.period || '未填写'}</span><span>归因：{current.plan.attribution}</span></div>
          <div className="flex flex-wrap gap-3 my-4"><a className="btn-ghost" href={`/api/projects/${current.parentId}/experiments/${current.id}/template.csv`} download>下载结果 CSV 模板</a><label className="btn-ghost cursor-pointer">读取 CSV 文件<input type="file" accept=".csv,text/csv" className="sr-only" onChange={e => { const file = e.target.files?.[0]; if (file) void file.text().then(setCsv).catch(error => setError(error.message)); e.target.value = '' }} /></label></div>
          <details><summary>粘贴或查看 CSV 数据</summary><textarea aria-label="实验结果 CSV" className="input mt-3 min-h-28 font-mono text-xs" value={csv} onChange={e => setCsv(e.target.value)} placeholder="version,startDate,endDate,impressions,clicks,conversions,spend,source" /></details>
          {csv && <button className="btn-primary my-3" disabled={!!busy} onClick={() => run('import', async () => { await api.importExperimentResults(current.parentId, current.id, csv); await refresh(current.id); setCsv(''); notify('结果已导入；相同版本与区间会更新，不重复累计') })}>校验并导入结果</button>}
          <div className="business-table-wrap"><table className="business-table"><thead><tr>{['版本', '曝光', '点击', '转化', '消耗（元）', 'CTR', 'CVR', 'CPA'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{current.versions.map(v => <tr key={v.projectId}><td>{v.label}{v.staleData && <Badge tone="amber">成片已变更</Badge>}</td>{(['impressions', 'clicks', 'conversions', 'spend'] as const).map(k => <td key={k}>{v.hasData ? v.totals[k].toLocaleString() : '—'}</td>)}{(['ctr', 'cvr', 'cpa'] as const).map(k => <td key={k}>{display(v.metrics[k], k)}</td>)}</tr>)}</tbody></table></div>
          <p className="business-help">{current.evidence} 0 转化时 CPA 显示“—”；没有数据不会显示为 0。</p>
          <div className="business-form-grid"><Field label="本轮结论"><textarea className="input" value={conclusion} onChange={e => setConclusion(e.target.value)} placeholder="记录观察结果、限制及是否继续验证" /></Field><Field label="下一轮创作建议"><textarea className="input" value={nextAction} onChange={e => setNextAction(e.target.value)} placeholder="例如：保留正文，下一轮只测试结尾 CTA" /></Field></div>
          <button className="btn-primary mt-4" disabled={!!busy} onClick={() => run('save', async () => { await api.saveExperimentConclusion(current.parentId, current.id, conclusion, nextAction); await refresh(current.id); notify('复盘结论已保存') })}>保存复盘</button>
          <button className="btn-ghost mt-4 ml-3" disabled={!!busy || !nextAction.trim()} onClick={() => run('next', async () => { await api.saveExperimentConclusion(current.parentId, current.id, conclusion, nextAction); const next = await api.nextExperimentTask(current.parentId, current.id); onUpdate(next); onOpen(next.id, 2); notify('下一轮任务已创建，复盘建议已带入推广需求') })}>带入下一轮创作 →</button>
        </Section>
      </>}
    </> : <div className="business-empty"><h2>把“做一个版本”变成“验证一个假设”</h2><p>选定任务，完成基准分镜后建立第一个实验。既有创意与视频会保留。</p></div>}
    {busy && <p role="status" className="business-help"><Spinner /> 正在处理，请稍候…</p>}
  </div>
}
