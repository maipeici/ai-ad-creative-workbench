import { useEffect, useState } from 'react'
import { api } from '../api'
import type { ExperimentReport, Project, ProjectSummary } from '../types'
import { Badge, Field, Section, Spinner } from '../ui'

type Props = { project: Project | null; projects: ProjectSummary[]; notify: (message: string, tone?: 'error' | 'ok') => void; onOpen: (id: string, phase?: number) => void; onUpdate: (project: Project) => void }
const metricNames: Record<string, string> = { ctr: '点击率', cvr: '点击转化率', cpa: '转化成本' }
const variables: Record<string, string> = { hook: '开头内容', cta: '结尾行动引导', multiple: '多个创意差异' }
const display = (n: number | null, metric: string) => n === null ? '暂无数据' : metric === 'cpa' ? '¥' + n.toFixed(2) : (n * 100).toFixed(2) + '%'

export default function ExperimentPanel({ project, projects, notify, onOpen, onUpdate }: Props) {
  const [items, setItems] = useState<ExperimentReport[]>([])
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [form, setForm] = useState({ mode: 'comparison', title: '', variable: 'hook', primaryMetric: 'ctr', hypothesis: '', audience: '', budget: '', period: '', attribution: '点击后 7 天，仅统计点击归因转化', trafficMethod: 'observational' })
  const [changes, setChanges] = useState<{ vo: string; subtitle: string; actionCn: string } | null>(null)
  const [csv, setCsv] = useState('')
  const [conclusion, setConclusion] = useState('')
  const [nextAction, setNextAction] = useState('')
  const root = project?.batchId || project?.experimentLink?.parentId || project?.id
  const current = items.find(e => e.id === selected)
  const refresh = async (id?: string) => {
    const reports = (await api.experiments()).filter(e => e.parentId === root)
    setItems(reports); setSelected(previous => id || (reports.some(e => e.id === previous) ? previous : reports[0]?.id || ''))
  }
  useEffect(() => { void refresh().catch(e => setError(e.message)); setPicked([]); setCreating(false) }, [root])
  useEffect(() => { setConclusion(current?.conclusion || ''); setNextAction(current?.nextAction || ''); setChanges(null); setCsv('') }, [selected])
  const run = async (key: string, work: () => Promise<void>) => {
    if (busy) return
    setBusy(key); setError('')
    try { await work() } catch (e: any) { setError(e.message); notify(e.message, 'error') } finally { setBusy('') }
  }
  const metric = current?.primaryMetric || 'ctr'
  const baseline = current?.versions[0]?.metrics[metric as 'ctr' | 'cvr' | 'cpa']
  return <div className="business-page">
    <div className="business-heading"><div><p className="eyebrow">MATERIAL TESTING</p><h1>素材测试</h1><p>用真实投放数据回答：哪种表达更值得继续做？这是可选环节，不影响批量制作与交付。</p></div><button className="btn-primary" disabled={!root || !!busy} onClick={() => setCreating(!creating)}>{creating ? '收起新测试' : '选择素材，建立测试'}</button></div>
    <div className="test-steps">{[['01','选素材','从本批成片中选择'],['02','设对照','明确差异与判断指标'],['03','导入数据','使用同口径投放结果'],['04','看结果','记录下一轮改什么']].map(([n,title,desc]) => <div key={n}><span>{n}</span><strong>{title}</strong><small>{desc}</small></div>)}</div>
    <div className="batch-toolbar"><label className="label !mb-0" htmlFor="test-project">当前项目</label><select id="test-project" className="input max-w-lg" value={root || ''} onChange={e => onOpen(e.target.value, 7)}><option value="" disabled>选择项目</option>{projects.filter(p => !p.experimentLink).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="text-link" disabled={!root} onClick={() => root && onOpen(root, 6)}>返回视频制作 →</button></div>
    {creating && project && <Section title="建立素材测试" desc="直接引用已有素材，不会复制一个新项目。可以先选一条基准素材，再制作单变量版本。">
      <div className="test-mode-grid">{[['comparison','多素材对比','比较不同创意的实际表现，适合筛选方向。'],['single-variable','单变量测试','只改变开头或 CTA，其他镜头与条件保持一致。']].map(([id,title,desc]) => <button key={id} className={'test-mode ' + (form.mode === id ? 'active' : '')} onClick={() => setForm({ ...form, mode: id })}><strong>{title}</strong><span>{desc}</span></button>)}</div>
      <div className="label mt-5">选择本批素材 · 第一条选中的素材作为 A 对照</div>
      <div className="test-material-options">{project.batch?.items.map(item => <label key={item.id} className={picked.includes(item.id) ? 'selected' : ''}><input type="checkbox" disabled={!item.videoUrl || item.stale} checked={picked.includes(item.id)} onChange={e => setPicked(e.target.checked ? [...picked, item.id] : picked.filter(id => id !== item.id))} /><strong>{item.name}</strong><span>{picked.includes(item.id) ? String.fromCharCode(65 + picked.indexOf(item.id)) + ' 版' : item.stale ? '待更新成片' : item.videoUrl ? '可选' : '尚无成片'}</span></label>)}</div>
      <div className="business-form-grid mt-5"><Field label="这次想验证什么？"><textarea className="input" placeholder="例如：先讲下班困境，是否比直接介绍产品更吸引点击？" value={form.hypothesis} onChange={e => setForm({ ...form, hypothesis: e.target.value })} /></Field><Field label="主要看哪个指标？"><select className="input" value={form.primaryMetric} onChange={e => setForm({ ...form, primaryMetric: e.target.value })}>{Object.entries(metricNames).map(([id,label]) => <option key={id} value={id}>{label}{id === 'cpa' ? ' · 越低越好' : ' · 越高越好'}</option>)}</select></Field>
        <Field label="测试名称"><input className="input" placeholder="例如：通勤广告开头对比" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></Field>{form.mode === 'single-variable' && <Field label="只改变哪一部分？"><select className="input" value={form.variable} onChange={e => setForm({ ...form, variable: e.target.value })}><option value="hook">开头内容</option><option value="cta">结尾行动引导</option></select></Field>}</div>
      <details className="business-disclosure mt-4"><summary>投放条件与统计口径</summary><div className="business-form-grid">{[['audience','固定人群'],['budget','预算分配'],['period','投放周期'],['attribution','归因口径']].map(([key,label]) => <Field key={key} label={label}><input className="input" value={(form as any)[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /></Field>)}</div><p className="business-help">实际分流和投放在广告后台执行，这里记录素材与结果。</p></details>
      <button className="btn-primary mt-4" disabled={!!busy || picked.length < (form.mode === 'comparison' ? 2 : 1) || !form.hypothesis.trim()} onClick={() => run('create', async () => { const result = await api.createExperiment(root!, { ...form, creativeIds: picked }); onUpdate(result.project); await refresh(result.experiment.id); setCreating(false); notify('测试已建立，已关联所选素材') })}>建立测试 · 已选 {picked.length} 条素材</button>
    </Section>}
    {error && <p role="alert" className="inspiration-error">{error}</p>}
    {!items.length && !creating && <div className="business-empty"><h2>还没有素材测试</h2><p>点击「选择素材，建立测试」，选出已有成片、确定比较问题，再导入真实投放数据。</p></div>}
    {!!items.length && <div className="business-selector">{items.map(e => <button key={e.id} className={e.id === selected ? 'chip-on' : 'chip-off'} disabled={!!busy} onClick={() => setSelected(e.id)}>{e.title}</button>)}</div>}
    {current && <>
      <Section title={current.title} desc={current.hypothesis} right={<Badge tone="blue">{current.mode === 'comparison' ? '多素材对比' : '单变量测试'} · {metricNames[metric]}</Badge>}>
        <div className="test-question"><div><span>本次比较</span><strong>{variables[current.variable] || current.variable}</strong></div><div><span>判断依据</span><strong>{metricNames[metric]}{metric === 'cpa' ? '越低越好' : '越高越好'}</strong></div><div><span>目前能否下结论</span><strong>{current.comparable ? '可观察差异，尚未验证显著性' : '暂不能判断，需补齐可比数据'}</strong></div></div>
        <div className="experiment-versions">{current.versions.map(v => {
          const value = v.metrics[metric as 'ctr'|'cvr'|'cpa']
          const change = current.comparable && baseline != null && baseline > 0 && value != null ? (value / baseline - 1) * 100 : null
          return <article className="experiment-version" key={v.projectId}><div className="flex justify-between gap-2"><strong>{v.label} · {v.name}</strong><Badge tone={v.staleVideo ? 'amber' : 'slate'}>{v.label === 'A' ? '对照素材' : v.staleVideo ? '成片待更新' : '比较素材'}</Badge></div>
            {v.videoUrl ? <video src={v.videoUrl} poster={v.cover || undefined} controls preload="metadata" /> : <div className="experiment-video-empty">完成变化镜头后即可合成</div>}
            <div className="test-metric"><span>{metricNames[metric]}</span><strong>{display(value, metric)}</strong><small>{v.staleData ? '素材已更新，请重新导入对应数据' : v.label !== 'A' && change !== null ? `较 A 版${change >= 0 ? '增加' : '减少'} ${Math.abs(change).toFixed(1)}%（描述性比较）` : v.hasData ? `曝光 ${v.totals.impressions.toLocaleString()} · 转化 ${v.totals.conversions}` : '导入真实投放数据后显示'}</small></div>
            <button className="btn-ghost" disabled={!v.available} onClick={() => onOpen(v.projectId, v.videoUrl ? 6 : 4)}>查看或修改素材</button></article>
        })}</div>
        {current.mode !== 'comparison' && <details className="business-disclosure mt-5"><summary>从 A 素材制作一个单变量版本</summary><p className="business-help">只替换第 {current.editableShotIndex} 镜的内容，其他镜头复用 A 素材。新版本会加入当前项目的素材列表。</p>
          {!changes ? <button className="btn-ghost" disabled={!!busy || !current.versions[0]?.videoUrl || current.versions.length >= 6} onClick={() => run('prepare', async () => { const p = await api.getProject(current.versions[0].projectId); const s = p.storyboard!.shots.find(s => s.id === current.editableShotId)!; setChanges({ vo: s.vo || '', subtitle: s.subtitle || '', actionCn: s.actionCn || '' }) })}>编辑变化镜头</button> : <><div className="business-form-grid">{[['actionCn','画面描述'],['vo','口播'],['subtitle','字幕']].map(([key,label]) => <Field key={key} label={label}><textarea className="input" value={(changes as any)[key]} onChange={e => setChanges({ ...changes, [key]: e.target.value })} /></Field>)}</div><button className="btn-primary mt-4" disabled={!!busy} onClick={() => run('version', async () => { const result = await api.experimentVersion(current.parentId, current.id, { changes }); onUpdate(result.project); await refresh(current.id); setChanges(null); notify('实验版已加入本批素材，固定镜头已复用') })}>创建单变量版本</button></>}
        </details>}
      </Section>
      <Section title="导入投放数据" desc="下载模板，将各素材对应的曝光、点击、转化和消耗填入，再导入。相同区间重新导入会更新，不会重复累计。">
        <div className="batch-toolbar"><a className="btn-ghost" href={`/api/projects/${current.parentId}/experiments/${current.id}/template.csv`} download>下载数据模板</a><label className="btn-ghost cursor-pointer">选择投放数据文件<input type="file" className="sr-only" accept=".csv,text/csv" onChange={e => { const file = e.target.files?.[0]; if (file) void file.text().then(setCsv).catch(e => setError(e.message)); e.target.value = '' }} /></label>{csv && <button className="btn-primary" disabled={!!busy} onClick={() => run('import', async () => { await api.importExperimentResults(current.parentId, current.id, csv); await refresh(current.id); setCsv(''); notify('投放数据已导入') })}>校验并导入</button>}</div>
        <details className="mt-4"><summary>粘贴或检查数据内容</summary><textarea aria-label="投放数据 CSV" className="input min-h-28 mt-3 font-mono text-xs" value={csv} onChange={e => setCsv(e.target.value)} /></details>
        <details className="business-disclosure mt-4"><summary>查看完整指标与统计口径</summary><p className="business-help">人群：{current.plan.audience || '未填写'} · 预算：{current.plan.budget || '未填写'} · 归因：{current.plan.attribution}</p><div className="business-table-wrap"><table className="business-table"><thead><tr>{['素材','曝光','点击','转化','消耗','点击率','转化率','转化成本'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{current.versions.map(v => <tr key={v.projectId}><td>{v.label}</td>{(['impressions','clicks','conversions','spend'] as const).map(k => <td key={k}>{v.hasData ? v.totals[k] : '—'}</td>)}{(['ctr','cvr','cpa'] as const).map(k => <td key={k}>{display(v.metrics[k], k)}</td>)}</tr>)}</tbody></table></div></details>
      </Section>
      <Section title="结果与下一步" desc={current.evidence}>
        <div className="test-conclusion"><strong>{current.comparable ? '先记录观察，再决定是否继续验证' : '数据不足，暂不能判断哪个素材更好'}</strong><p>{current.mode === 'comparison' ? '多个创意同时变化，表现差异不能归因到某一个因素。可以从表现较好的方向再做单变量测试。' : '单变量素材也需要相同投放条件与可靠分流；指标差异本身不等于因果结论。'}</p></div>
        <div className="business-form-grid mt-4"><Field label="这次观察到什么？"><textarea className="input" value={conclusion} onChange={e => setConclusion(e.target.value)} placeholder="例如：B 点击率较高，但转化样本少，继续观察。" /></Field><Field label="下一轮具体改什么？"><textarea className="input" value={nextAction} onChange={e => setNextAction(e.target.value)} placeholder="例如：保留正文和 CTA，仅测试新的开场问题。" /></Field></div>
        <div className="batch-toolbar mt-4"><button className="btn-primary" disabled={!!busy} onClick={() => run('save', async () => { await api.saveExperimentConclusion(current.parentId, current.id, conclusion, nextAction); await refresh(current.id); notify('观察与建议已保存') })}>保存观察与建议</button><button className="btn-ghost" disabled={!!busy || !nextAction.trim()} onClick={() => run('next', async () => { await api.saveExperimentConclusion(current.parentId, current.id, conclusion, nextAction); const p = await api.nextExperimentTask(current.parentId, current.id); onOpen(p.id, 2); notify('已带入下一轮投放需求') })}>带入下一轮创作 →</button></div>
      </Section>
    </>}
    {busy && <p role="status" className="business-help"><Spinner /> 正在保存…</p>}
  </div>
}
