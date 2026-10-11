import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { PhaseProps } from '../App'
import type { InspirationReference, InspirationLibrary } from '../inspiration-types'
import { Badge, EmptyHint, Field, Modal, Section, Spinner } from '../ui'
import '../styles/inspiration.css'

type Props = PhaseProps & {onApplied: () => void}
const count = (v: number | null | undefined) => v == null ? '未提供' : new Intl.NumberFormat('zh-CN', {notation:'compact',maximumFractionDigits:1}).format(v)
const emptyForm = {title:'',platform:'douyin',industry:'mobility',contentType:'organic',sourceUrl:'',creator:'',tags:'',script:'',sourceNote:'',publishedAt:'',observedAt:'',views:'',likes:'',comments:'',shares:'',saves:'',ctr:'',cvr:'',cpa:'',isDemo:false}
const metricLabels = {views:'播放量',likes:'点赞',comments:'评论',shares:'分享',saves:'收藏',ctr:'CTR（%）',cvr:'CVR（%）',cpa:'CPA（元）'}
export default function InspirationPanel({project,meta,setProject,notify,onApplied}: Props) {
  const [library,setLibrary]=useState<InspirationLibrary|null>(null)
  const [platform,setPlatform]=useState<string|null>(null),[industry,setIndustry]=useState<string|null>(null)
  const [keyword,setKeyword]=useState(''),[days,setDays]=useState('0'),[sort,setSort]=useState('match'),[mode,setMode]=useState('imported')
  const [refresh,setRefresh]=useState(0),[loading,setLoading]=useState(false),[loadError,setLoadError]=useState('')
  const [activeId,setActiveId]=useState(''),[selected,setSelected]=useState<string[]>([]),[busy,setBusy]=useState('')
  const [actionError,setActionError]=useState('')
  const [editing,setEditing]=useState<string|null>(null),[form,setForm]=useState(emptyForm),[showForm,setShowForm]=useState(false),[formError,setFormError]=useState('')
  const [saving,setSaving]=useState(false),[importError,setImportError]=useState('')
  const fileInput=useRef<HTMLInputElement>(null)
  useEffect(()=>{let alive=true;setLoading(true);setLoadError('')
    const timer=setTimeout(()=>{api.inspirations({projectId:project.id,platform:platform??'',industry:industry??'',keyword,days,sort,mode}).then(data=>{
      if(!alive)return
      if(platform===null||industry===null){setPlatform(platform??data.defaults.platform);setIndustry(industry??data.defaults.industry)}
      setLibrary(data);setActiveId(old=>data.items.some(r=>r.id===old)?old:data.items[0]?.id||'')
    }).catch(e=>alive&&setLoadError(e.message)).finally(()=>alive&&setLoading(false))},180)
    return()=>{alive=false;clearTimeout(timer)}
  },[project.id,project.brief.channel,platform,industry,keyword,days,sort,mode,refresh])
  const active=library?.items.find(r=>r.id===activeId)
  const analysis=active?project.inspirationAnalyses?.[active.id]:null
  useEffect(()=>{setSelected(analysis?.suggestions.map(s=>s.id)||[])},[activeId,analysis?.analyzedAt])
  useEffect(()=>{setActionError('')},[activeId])
  const name=(kind:'platforms'|'industries',id:string)=>library?.[kind].find(p=>p.id===id)?.name||id
  const openForm=(ref?:InspirationReference)=>{
    setForm(ref?{...emptyForm,...ref,...Object.fromEntries(Object.entries(ref.metrics).map(([k,v])=>[k,v==null?'':String(v)]))}: {...emptyForm,platform:platform||'douyin',industry:industry||'mobility'})
    setEditing(ref?.id||null);setFormError('');setShowForm(true)
  }
  const save=async(e:React.FormEvent)=>{e.preventDefault();setSaving(true);setFormError('')
    try {const data={...form,metrics:Object.fromEntries(Object.keys(metricLabels).map(k=>[k,form[k as keyof typeof metricLabels]]))}
      const saved=editing?await api.updateInspiration(editing,data):await api.createInspiration(data)
      setPlatform(saved.platform);setIndustry(saved.industry);setMode(saved.isDemo?'demo':'imported');setDays('0');setKeyword('');setActiveId(saved.id);setRefresh(x=>x+1);setShowForm(false);notify('参考已保存，可开始拆解脚本。')
    }catch(e:any){setFormError(e.message)}finally{setSaving(false)}}
  const importFile=async(file?:File)=>{if(!file)return;setImportError('');setSaving(true)
    try{if(file.size>3*1024*1024)throw new Error('每次导入文件不超过 3 MB。');const format=file.name.toLowerCase().endsWith('.csv')?'csv':file.name.toLowerCase().endsWith('.json')?'json':'';if(!format)throw new Error('请选择 CSV 或 JSON 文件。')
      const result=await api.importInspirations(await file.text(),format)
      setPlatform('');setIndustry('');setDays('0');setKeyword('');setMode(result.items.every(r=>r.isDemo)?'demo':'imported');setRefresh(x=>x+1);notify(`已导入 ${result.count} 条参考，重复视频链接会更新原记录。`)
    }catch(e:any){setImportError(e.message)}finally{setSaving(false);if(fileInput.current)fileInput.current.value=''}}
  const analyze=async()=>{if(!active||busy)return;setBusy('analyze');setActionError('')
    try{const r=await api.analyzeInspiration(project.id,active.id);setProject(r.project);notify('脚本已拆解，选择你希望复用的建议。')}catch(e:any){setActionError(e.message);notify(e.message,'error')}finally{setBusy('')}}
  const apply=async()=>{if(!active||busy)return;setBusy('apply');setActionError('')
    try{const r=await api.applyInspiration(project.id,active.id,selected);setProject(r.project);notify('已追加一份参考创意，保留原方案；可在创意列表中选择。');onApplied()}catch(e:any){setActionError(e.message);notify(e.message,'error')}finally{setBusy('')}}
  return <Section title="爆款参考 · 脚本拆解 Agent" desc="先找到同行同平台的参考，再把可迁移的方法带进当前创意。" right={<Badge tone="blue">导入素材库</Badge>}>
    <div className="inspiration-intro"><div><strong>找到参考 → 拆解脚本 → 选择方法 → 生成创意</strong><p>推荐来自已导入的资料。热度表示内容互动，CTR / CVR / CPA 表示投放效果；没有提供的数据会保留为空。</p></div><button className="btn-primary" onClick={()=>openForm()} disabled={!!busy}>＋ 导入视频参考</button></div>
    <div className="inspiration-toolbar">
      <div className="inspiration-mode" aria-label="参考来源"><button className={mode==='imported'?'active':''} onClick={()=>setMode('imported')} disabled={!!busy}>我的参考库 <span>{library?.importedCount??0}</span></button><button className={mode==='demo'?'active':''} onClick={()=>setMode('demo')} disabled={!!busy}>结构示例</button></div>
      <div className="flex flex-wrap gap-3 items-center"><input ref={fileInput} type="file" accept=".csv,.json" className="hidden" onChange={e=>void importFile(e.target.files?.[0])}/><button className="btn-ghost" disabled={saving||!!busy} onClick={()=>fileInput.current?.click()}>{saving?<Spinner/>:null} 批量导入</button><a className="inspiration-link" href="/examples/inspiration-import.csv" download>下载 CSV 模板</a></div>
    </div>
    {importError&&<p className="inspiration-error" role="alert">{importError}</p>}
    <div className="inspiration-filters">
      <Field label="信息流平台"><select aria-label="参考平台" className="input" value={platform??''} disabled={!!busy} onChange={e=>setPlatform(e.target.value)}><option value="">全部平台</option>{library?.platforms.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="所属行业"><select aria-label="参考行业" className="input" value={industry??''} disabled={!!busy} onChange={e=>setIndustry(e.target.value)}><option value="">全部行业</option>{library?.industries.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="发布时间"><select aria-label="参考发布时间" className="input" value={days} disabled={!!busy} onChange={e=>setDays(e.target.value)}><option value="0">不限时间</option><option value="7">近 7 天</option><option value="30">近 30 天</option><option value="90">近 90 天</option></select></Field>
      <Field label="排序方式"><select aria-label="参考排序方式" className="input" value={sort} disabled={!!busy} onChange={e=>setSort(e.target.value)}><option value="match">需求匹配优先</option><option value="recent">最新发布</option><option value="heat">点赞量</option></select></Field>
      <Field label="人群 / 场景 / 关键词"><input aria-label="搜索视频参考" className="input" placeholder="例如：通勤、雨天、开箱" value={keyword} disabled={!!busy} onChange={e=>setKeyword(e.target.value)}/></Field>
    </div>
    {mode==='demo'&&<p className="inspiration-notice">当前为结构示例：脚本用于体验拆解流程，没有真实原视频或热度数据。导入自己的参考后可在“我的参考库”查看。</p>}
    {sort==='heat'&&<p className="inspiration-notice">当前按已导入点赞量排序。不同平台、行业和统计时间的数值不可直接作为效果对比。</p>}
    {loading?<div className="inspiration-loading"><Spinner/> 正在整理参考…</div>:loadError?<div className="inspiration-error" role="alert">{loadError} <button onClick={()=>setRefresh(x=>x+1)}>重试</button></div>:!library?.items.length?<div className="inspiration-empty"><span>01 / 建立自己的创意参考库</span><h4>{library?.importedCount?'没有符合当前条件的参考':'导入一条视频，开始拆解它的脚本'}</h4><p>保存视频链接，补充口播或字幕、平台、行业与热度快照。之后可按当前投放需求筛选，生成适配本品牌的创意。</p><div className="flex gap-3 flex-wrap"><button className="btn-primary" onClick={()=>openForm()}>导入第一条参考</button><button className="btn-ghost" onClick={()=>{setMode('demo');setPlatform('');setIndustry('');setDays('0');setKeyword('')}}>先体验结构示例</button></div></div>:
    <div className="inspiration-workspace"><aside className="inspiration-results" aria-label="视频参考推荐"><p className="inspiration-count">{library.items.length} 条参考 · 按当前条件筛选</p>{library.items.map(r=><button key={r.id} className={'inspiration-card '+(r.id===activeId?'selected':'')} disabled={!!busy} aria-pressed={r.id===activeId} onClick={()=>setActiveId(r.id)}>
      <div className="flex flex-wrap gap-2"><Badge tone="brand">{name('platforms',r.platform)}</Badge><Badge>{r.contentType==='ad'?'信息流广告':'自然内容'}</Badge>{r.isDemo&&<Badge tone="amber">示例</Badge>}</div><h4>{r.title}</h4><p>{r.creator||name('industries',r.industry)} · {r.publishedAt||'发布日期未提供'}</p>
      <div className="inspiration-card-metrics"><span>播放 <b>{count(r.metrics.views)}</b></span><span>点赞 <b>{count(r.metrics.likes)}</b></span><span>收藏 <b>{count(r.metrics.saves)}</b></span></div><div className="inspiration-reasons">{r.reasons?.slice(2).join(' · ')||'按所选平台与行业匹配'}</div>
    </button>)}</aside>
    {active&&<article className="inspiration-detail"><div className="inspiration-detail-header"><div><div className="flex gap-2 mb-2 flex-wrap"><Badge tone="brand">{name('platforms',active.platform)}</Badge><Badge>{name('industries',active.industry)}</Badge></div><h3>{active.title}</h3><p>{active.creator||'创作者未提供'}</p></div><div className="flex gap-3 items-center flex-wrap">{active.sourceUrl&&<a className="inspiration-link" href={active.sourceUrl} target="_blank" rel="noopener noreferrer">打开原视频 ↗</a>}{!active.id.startsWith('demo-')&&<button className="btn-ghost" disabled={!!busy} onClick={()=>openForm(active)}>编辑资料</button>}</div></div>
      <div className="inspiration-metrics">{Object.entries(metricLabels).filter(([k])=>active.contentType==='ad'||!['ctr','cvr','cpa'].includes(k)).map(([k,label])=><div key={k}><span>{label}</span><strong>{count(active.metrics[k as keyof typeof active.metrics])}</strong></div>)}</div>
      <p className="inspiration-source">数据来源：{active.sourceNote||'未提供'}<br/>统计日期：{active.observedAt||'未提供'} · 发布日期：{active.publishedAt||'未提供'}</p>
      <details className="inspiration-script" open={!analysis}><summary>原始脚本 / 字幕 <span>{active.script.length} 字</span></summary><p>{active.script||'尚未提供脚本。请编辑资料后开始拆解。'}</p></details>
      <div className="inspiration-analysis-heading"><div><h4>脚本拆解与复用建议</h4><p>结合当前项目：{meta.brandGuide.brandIdentity.productName} · {project.brief.durationSec} 秒 · {meta.channels.find(c=>c.id===project.brief.channel)?.name}</p></div><button className="btn-primary" disabled={!!busy||active.script.length<20} onClick={analyze}>{busy==='analyze'?<><Spinner/> 正在拆解…</>:analysis?'重新拆解':'拆解脚本'}</button></div>
      <p className="inspiration-source">基于导入文本分析，不自动抓取或下载原片；未提供的镜头画面不会当作已验证信息。</p>
      {actionError&&<p className="inspiration-error" role="alert">{actionError}</p>}
      {analysis?<><div className="inspiration-summary"><Badge tone="blue">{analysis.source==='gemini'?'Gemini':'AI'} 脚本分析</Badge><p>{analysis.summary}</p><small>{new Date(analysis.analyzedAt).toLocaleString('zh-CN')} · 资料或需求变化后需重新拆解</small></div>
        <ol className="inspiration-timeline">{analysis.segments.map((s,i)=><li key={i}><div><b>{String(i+1).padStart(2,'0')}</b><span>{s.timing}</span></div><section><h5>{s.role}</h5><blockquote>{s.evidence}</blockquote><p>{s.explanation}</p></section></li>)}</ol>
        <div className="inspiration-reuse-heading"><h4>选择要带入创意的方法</h4><span>已选 {selected.length} 项</span></div><div className="inspiration-suggestions">{analysis.suggestions.map(s=><label key={s.id} className={'inspiration-suggestion '+(selected.includes(s.id)?'checked':'')}><div className="flex gap-2 items-center"><input type="checkbox" checked={selected.includes(s.id)} disabled={!!busy} onChange={e=>setSelected(old=>e.target.checked?[...old,s.id]:old.filter(id=>id!==s.id))}/><strong>{s.label}</strong></div><p className="inspiration-pattern">{s.pattern}</p><div><b>用于当前广告</b><p>{s.adaptation}</p></div>{s.caution&&<small>复用边界：{s.caution}</small>}{s.testHypothesis&&<small>可验证假设：{s.testHypothesis}</small>}</label>)}</div>
        <p className="inspiration-notice">{analysis.limitations}</p><div className="inspiration-apply"><p>将所选方法改写成当前品牌的新创意，并保留来源。已有创意和成片继续保留。</p><button className="btn-primary" disabled={!!busy||!selected.length} onClick={apply}>{busy==='apply'?<><Spinner/> 正在生成参考创意…</>:'一键复用到广告创意 →'}</button></div></>:<EmptyHint>点击“拆解脚本”，查看开场钩子、内容结构、产品呈现与 CTA，并获得针对当前项目的复用建议。</EmptyHint>}
    </article>}</div>}
    <Modal open={showForm} title={editing?'编辑视频参考':'导入视频参考'} onClose={()=>!saving&&setShowForm(false)} wide><form onSubmit={save} className="inspiration-import space-y-4">
      <p className="inspiration-source">链接用于溯源；请同时粘贴脚本、口播或字幕，才能进行拆解。热度与投放指标可留空。</p>
      <Field label="视频标题 *"><input aria-label="视频参考标题" className="input" required maxLength={120} value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></Field>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3"><Field label="平台 *"><select aria-label="导入平台" className="input" value={form.platform} onChange={e=>setForm({...form,platform:e.target.value})}>{library?.platforms.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="行业 *"><select aria-label="导入行业" className="input" value={form.industry} onChange={e=>setForm({...form,industry:e.target.value})}>{library?.industries.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="内容类型"><select aria-label="导入内容类型" className="input" value={form.contentType} onChange={e=>setForm({...form,contentType:e.target.value,ctr:'',cvr:'',cpa:''})}><option value="organic">自然内容</option><option value="ad">信息流广告</option></select></Field></div>
      <Field label="原视频链接"><input aria-label="原视频链接" className="input" type="url" placeholder="https://…" value={form.sourceUrl} onChange={e=>setForm({...form,sourceUrl:e.target.value})}/></Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><Field label="创作者 / 品牌"><input aria-label="参考创作者" className="input" value={form.creator} onChange={e=>setForm({...form,creator:e.target.value})}/></Field><Field label="场景 / 人群关键词"><input aria-label="参考关键词" className="input" placeholder="通勤、下班、雨天" value={form.tags} onChange={e=>setForm({...form,tags:e.target.value})}/></Field></div>
      <Field label="脚本 / 口播 / 字幕" hint="拆解需至少 20 字；可逐段附时间与画面描述"><textarea aria-label="导入脚本" className="input min-h-[150px]" maxLength={24000} value={form.script} onChange={e=>setForm({...form,script:e.target.value})}/></Field>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{Object.entries(metricLabels).filter(([k])=>form.contentType==='ad'||!['ctr','cvr','cpa'].includes(k)).map(([k,label])=><Field key={k} label={label}><input aria-label={'导入'+label} className="input" inputMode="decimal" placeholder="未提供" value={form[k as keyof typeof metricLabels]} onChange={e=>setForm({...form,[k]:e.target.value})}/></Field>)}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><Field label="发布日期"><input aria-label="参考发布日期" type="date" className="input" value={form.publishedAt} onChange={e=>setForm({...form,publishedAt:e.target.value})}/></Field><Field label="数据统计日期" hint="填写指标时必填"><input aria-label="参考统计日期" type="date" className="input" value={form.observedAt} onChange={e=>setForm({...form,observedAt:e.target.value})}/></Field></div>
      <Field label="数据来源说明" hint="填写指标时必填"><input aria-label="数据来源说明" className="input" placeholder="例如：原视频页面公开计数，2026-10-11 手动记录" value={form.sourceNote} onChange={e=>setForm({...form,sourceNote:e.target.value})}/></Field>
      <label className="flex gap-2 text-sm items-center"><input type="checkbox" checked={form.isDemo} onChange={e=>setForm({...form,isDemo:e.target.checked})}/>这是演示 / 测试数据（只进入结构示例）</label>
      {formError&&<p role="alert" className="inspiration-error">{formError}</p>}<div className="flex gap-3 justify-end"><button type="button" className="btn-ghost" disabled={saving} onClick={()=>setShowForm(false)}>取消</button><button type="submit" className="btn-primary" disabled={saving}>{saving&&<Spinner/>}保存参考</button></div>
    </form></Modal>
  </Section>
}
