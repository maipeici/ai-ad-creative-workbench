import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { PhaseProps } from '../App'
import type { InspirationReference, InspirationLibrary } from '../inspiration-types'
import { Badge, EmptyHint, Field, Modal, Section, Spinner } from '../ui'
import '../styles/inspiration.css'

type Props = PhaseProps & {onApplied: (id:string) => void}
const count = (v: number | null | undefined) => v == null ? '未提供' : new Intl.NumberFormat('zh-CN', {notation:'compact',maximumFractionDigits:1}).format(v)
const emptyForm = {title:'',platform:'douyin',industry:'mobility',contentType:'organic',sourceUrl:'',creator:'',tags:'',script:'',sourceNote:'',publishedAt:'',observedAt:'',views:'',likes:'',comments:'',shares:'',saves:'',ctr:'',cvr:'',cpa:'',isDemo:false}
const metricLabels = {views:'播放量',likes:'点赞',comments:'评论',shares:'分享',saves:'收藏',ctr:'CTR（%）',cvr:'CVR（%）',cpa:'CPA（元）'}
type ReferenceView = {mode:'imported'|'demo'|'analyzed';activeId:string;platform:string|null;industry:string|null;keyword:string;days:string;sort:string}
function recallView(project: Props['project']): ReferenceView {
  const recent=Object.values(project.inspirationAnalyses||{}).sort((a,b)=>b.analyzedAt.localeCompare(a.analyzedAt))[0]
  const fallback:ReferenceView={mode:recent?'analyzed':'imported',activeId:recent?.referenceId||'',platform:recent?'':null,industry:recent?'':null,keyword:'',days:'0',sort:'match'}
  try {const saved=JSON.parse(sessionStorage.getItem('reference-view:'+project.id)||'null');return saved&&['imported','demo','analyzed'].includes(saved.mode)?{...fallback,...saved}:fallback} catch {return fallback}
}
export default function InspirationPanel({project,meta,setProject,notify,onApplied}: Props) {
  const [initialView]=useState(()=>recallView(project))
  const [library,setLibrary]=useState<InspirationLibrary|null>(null)
  const [platform,setPlatform]=useState(initialView.platform),[industry,setIndustry]=useState(initialView.industry)
  const [keyword,setKeyword]=useState(initialView.keyword),[days,setDays]=useState(initialView.days),[sort,setSort]=useState(initialView.sort),[mode,setMode]=useState<string>(initialView.mode)
  const [refresh,setRefresh]=useState(0),[loading,setLoading]=useState(false),[loadError,setLoadError]=useState('')
  const [activeId,setActiveId]=useState(initialView.activeId),[selected,setSelected]=useState<string[]>([]),[busy,setBusy]=useState('')
  const locked=Boolean(project.versionPlan||(project.batch?.items.length||0)>1)
  const [actionError,setActionError]=useState('')
  const [targetConceptId,setTargetConceptId]=useState('')
  const [videoFile,setVideoFile]=useState<File|null>(null),[autoAnalyze,setAutoAnalyze]=useState(true),[saveStage,setSaveStage]=useState('')
  const videoPlayer=useRef<HTMLVideoElement>(null)
  const [editing,setEditing]=useState<string|null>(null),[form,setForm]=useState(emptyForm),[showForm,setShowForm]=useState(false),[formError,setFormError]=useState('')
  const [saving,setSaving]=useState(false),[importError,setImportError]=useState('')
  const fileInput=useRef<HTMLInputElement>(null)
  useEffect(()=>{if(!library||loading)return;try{sessionStorage.setItem('reference-view:'+project.id,JSON.stringify({mode,activeId,platform,industry,keyword,days,sort}))}catch{/* Storage is optional. */}},[project.id,library,loading,mode,activeId,platform,industry,keyword,days,sort])
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
    setEditing(ref?.id||null);setVideoFile(null);setAutoAnalyze(true);setFormError('');setShowForm(true)
  }
  const save=async(e:React.FormEvent)=>{e.preventDefault();setSaving(true);setFormError('')
    try {if(videoFile&&videoFile.size>14*1024*1024)throw new Error('参考视频不能超过 14 MB，请先压缩。')
      setSaveStage('正在保存资料…')
      const data={...form,metrics:Object.fromEntries(Object.keys(metricLabels).map(k=>[k,form[k as keyof typeof metricLabels]]))}
      let saved=editing?await api.updateInspiration(editing,data):await api.createInspiration(data)
      setEditing(saved.id)
      if(videoFile){setSaveStage('正在上传视频…');saved=await api.uploadInspirationVideo(saved.id,videoFile);setVideoFile(null)}
      setPlatform(saved.platform);setIndustry(saved.industry);setMode(saved.isDemo?'demo':'imported');setDays('0');setKeyword('');setActiveId(saved.id);setRefresh(x=>x+1)
      if(autoAnalyze&&(saved.video||saved.script.length>=20)){setSaveStage(saved.video?'正在观看视频并拆解…':'正在拆解脚本…');const r=await api.analyzeInspiration(project.id,saved.id);setProject(r.project);setRefresh(x=>x+1)}
      setShowForm(false);notify(autoAnalyze&&(saved.video||saved.script.length>=20)?'拆解完成，选择参考点后即可导入方案。':'参考已保存，上传视频或补充脚本后可开始拆解。')
    }catch(e:any){setFormError(e.message)}finally{setSaving(false);setSaveStage('')}}
  const importFile=async(file?:File)=>{if(!file)return;setImportError('');setSaving(true)
    try{if(file.size>3*1024*1024)throw new Error('每次导入文件不超过 3 MB。');const format=file.name.toLowerCase().endsWith('.csv')?'csv':file.name.toLowerCase().endsWith('.json')?'json':'';if(!format)throw new Error('请选择 CSV 或 JSON 文件。')
      const result=await api.importInspirations(await file.text(),format)
      setPlatform('');setIndustry('');setDays('0');setKeyword('');setMode(result.items.every(r=>r.isDemo)?'demo':'imported');setRefresh(x=>x+1);notify(`已导入 ${result.count} 条参考，重复视频链接会更新原记录。`)
    }catch(e:any){setImportError(e.message)}finally{setSaving(false);if(fileInput.current)fileInput.current.value=''}}
  const analyze=async()=>{if(!active||busy)return;setBusy('analyze');setActionError('')
    try{const r=await api.analyzeInspiration(project.id,active.id);setProject(r.project);setRefresh(x=>x+1);notify('脚本已拆解，选择你希望复用的建议。')}catch(e:any){setActionError(e.message);notify(e.message,'error')}finally{setBusy('')}}
  const apply=async()=>{if(!active||busy||locked)return;setBusy('apply');setActionError('')
    try{const r=await api.applyInspiration(project.id,active.id,selected,targetConceptId||undefined);setProject(r.project);notify('参考创作指导已导入，新方案已选中，可继续生成分镜。');onApplied(r.concept.id)}catch(e:any){setActionError(e.message);notify(e.message,'error')}finally{setBusy('')}}
  return <Section title="爆款参考 · 脚本拆解 Agent" desc="先找到同行同平台的参考，再把可迁移的方法带进当前创意。" right={<Badge tone="blue">导入素材库</Badge>}>
    <div className="inspiration-intro"><div><strong>上传视频 → 自动拆解 → 导入方案 → 参考分镜与视频</strong><p>识别画面、字幕与声音，提炼爆款点及可复用方法。所选参考点随创意方案进入后续制作。</p></div><button className="btn-primary" onClick={()=>openForm()} disabled={!!busy}>＋ 导入视频参考</button></div>
    <div className="inspiration-toolbar">
      <div className="inspiration-mode" aria-label="参考来源"><button className={mode==='analyzed'?'active':''} aria-pressed={mode==='analyzed'} onClick={()=>{setMode('analyzed');setPlatform('');setIndustry('');setDays('0');setKeyword('')}} disabled={!!busy}>本项目已拆解 <span>{library?.analyzedCount??Object.keys(project.inspirationAnalyses||{}).length}</span></button><button className={mode==='imported'?'active':''} aria-pressed={mode==='imported'} onClick={()=>setMode('imported')} disabled={!!busy}>我的参考库 <span>{library?.importedCount??0}</span></button><button className={mode==='demo'?'active':''} aria-pressed={mode==='demo'} onClick={()=>setMode('demo')} disabled={!!busy}>结构示例</button></div>
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
    {mode==='demo'&&<p className="inspiration-notice">当前为演示视频与结构示例，用于体验拆解流程，没有真实热度数据。正式导入的参考在“我的参考库”查看。</p>}
    {mode==='analyzed'&&<p className="inspiration-source">这里保留本项目已完成的拆解结果，包括标记为“示例”的演示参考。选择参考即可查看脚本分段与复用建议。</p>}
    {locked&&<p className="inspiration-notice" role="status">本项目已建立视频版本，核心创意已锁定。你仍可查看和拆解参考；如需采用新创意，请新建项目后导入。</p>}
    {sort==='heat'&&<p className="inspiration-notice">当前按已导入点赞量排序。不同平台、行业和统计时间的数值不可直接作为效果对比。</p>}
    {loading?<div className="inspiration-loading"><Spinner/> 正在整理参考…</div>:loadError?<div className="inspiration-error" role="alert">{loadError} <button onClick={()=>setRefresh(x=>x+1)}>重试</button></div>:!library?.items.length?<div className="inspiration-empty"><span>01 / 建立自己的创意参考库</span><h4>{mode==='analyzed'?'暂未找到已拆解的参考':library?.importedCount?'没有符合当前条件的参考':'导入一条视频，开始拆解它的脚本'}</h4><p>保存视频链接，补充口播或字幕、平台、行业与热度快照。之后可按当前投放需求筛选，生成适配本品牌的创意。</p><div className="flex gap-3 flex-wrap"><button className="btn-primary" onClick={()=>openForm()}>导入第一条参考</button><button className="btn-ghost" onClick={()=>{setMode('demo');setPlatform('');setIndustry('');setDays('0');setKeyword('')}}>先体验结构示例</button></div></div>:
    <div className="inspiration-workspace"><aside className="inspiration-results" aria-label="视频参考推荐"><p className="inspiration-count">{library.items.length} 条参考 · 按当前条件筛选</p>{library.items.map(r=><button key={r.id} className={'inspiration-card '+(r.id===activeId?'selected':'')} disabled={!!busy} aria-pressed={r.id===activeId} onClick={()=>setActiveId(r.id)}>
      <div className="flex flex-wrap gap-2"><Badge tone="brand">{name('platforms',r.platform)}</Badge><Badge>{r.contentType==='ad'?'信息流广告':'自然内容'}</Badge>{r.isDemo&&<Badge tone="amber">示例</Badge>}</div><h4>{r.title}</h4><p>{r.creator||name('industries',r.industry)} · {r.publishedAt||'发布日期未提供'}</p>
      <div className="inspiration-card-metrics"><span>播放 <b>{count(r.metrics.views)}</b></span><span>点赞 <b>{count(r.metrics.likes)}</b></span><span>收藏 <b>{count(r.metrics.saves)}</b></span></div><div className="inspiration-reasons">{r.reasons?.slice(2).join(' · ')||'按所选平台与行业匹配'}</div>
    </button>)}</aside>
    {active&&<article className="inspiration-detail"><div className="inspiration-detail-header"><div><div className="flex gap-2 mb-2 flex-wrap"><Badge tone="brand">{name('platforms',active.platform)}</Badge><Badge>{name('industries',active.industry)}</Badge></div><h3>{active.title}</h3><p>{active.creator||'创作者未提供'}</p></div><div className="flex gap-3 items-center flex-wrap">{active.sourceUrl&&<a className="inspiration-link" href={active.sourceUrl} target="_blank" rel="noopener noreferrer">打开原视频 ↗</a>}{!active.id.startsWith('demo-')&&<button className="btn-ghost" disabled={!!busy} onClick={()=>openForm(active)}>编辑资料</button>}</div></div>
      <div className="inspiration-metrics">{Object.entries(metricLabels).filter(([k])=>active.contentType==='ad'||!['ctr','cvr','cpa'].includes(k)).map(([k,label])=><div key={k}><span>{label}</span><strong>{count(active.metrics[k as keyof typeof active.metrics])}</strong></div>)}</div>
      <p className="inspiration-source">数据来源：{active.sourceNote||'未提供'}<br/>统计日期：{active.observedAt||'未提供'} · 发布日期：{active.publishedAt||'未提供'}</p>
      {active.video&&<div className="reference-video"><video key={active.video.url} ref={videoPlayer} src={active.video.url} controls preload="metadata"/><p>{active.video.name} · {(active.video.size/1024/1024).toFixed(1)} MB · 拆解时间码可定位原片</p></div>}
      <details className="inspiration-script" open={!analysis&&!active.video}><summary>{analysis?.inputKind==='video'?'自动识别脚本 / 字幕':'原始脚本 / 字幕'}</summary><p>{analysis?.inputKind==='video'?analysis.transcript:active.script||'上传视频后自动识别，无需手动撰写脚本。'}</p></details>
      <div className="inspiration-analysis-heading"><div><h4>视频拆解与参考点</h4><p>结合当前项目：{meta.brandGuide.brandIdentity.productName} · {project.brief.durationSec} 秒 · {meta.channels.find(c=>c.id===project.brief.channel)?.name}</p></div><button className="btn-primary" disabled={!!busy||(!active.video&&active.script.length<20)} onClick={analyze}>{busy==='analyze'?<><Spinner/> 正在拆解…</>:analysis?'重新拆解':active.video?'自动拆解视频':'拆解脚本'}</button></div>
      <p className="inspiration-source">{active.video?'将上传视频的画面与声音交给 Gemini 分析；爆款点是基于观察的假设，可结合投放实验验证。':'当前为文本拆解。上传原视频可自动识别画面、声音与脚本；平台分享链接仅用于溯源。'}</p>
      {actionError&&<p className="inspiration-error" role="alert">{actionError}</p>}
      {analysis?<><div className="inspiration-summary"><Badge tone="blue">{analysis.source==='gemini'?'Gemini':'AI'} · {analysis.inputKind==='video'?'已分析视频画面与声音':'仅分析文本'}</Badge><p>{analysis.summary}</p><small>{new Date(analysis.analyzedAt).toLocaleString('zh-CN')} · 资料或需求变化后需重新拆解</small></div>
        {!!analysis.highlights?.length&&<div className="reference-highlights"><h4>爆款点 · 为什么可能吸引人</h4>{analysis.highlights.map((h,i)=><div key={i}><strong>{h.point}</strong><p><b>观察依据</b> {h.evidence}</p><p><b>机制假设</b> {h.mechanism}</p></div>)}</div>}
        <ol className="inspiration-timeline">{analysis.segments.map((s,i)=><li key={i}><div><b>{String(i+1).padStart(2,'0')}</b>{active.video&&s.startSec!=null?<button className="inspiration-link" onClick={()=>{if(videoPlayer.current){videoPlayer.current.currentTime=s.startSec!;videoPlayer.current.scrollIntoView({block:'center',behavior:'smooth'})}}}>{s.timing} ↗</button>:<span>{s.timing}</span>}</div><section><h5>{s.role}</h5><blockquote>{s.evidence}</blockquote>{s.visual&&<p><b>画面</b> {s.visual}</p>}{s.audio&&<p><b>声音</b> {s.audio}</p>}<p>{s.explanation}</p></section></li>)}</ol>
        <div className="inspiration-reuse-heading"><h4>选择要带入创意的方法</h4><span>已选 {selected.length} 项</span></div><div className="inspiration-suggestions">{analysis.suggestions.map(s=><label key={s.id} className={'inspiration-suggestion '+(selected.includes(s.id)?'checked':'')}><div className="flex gap-2 items-center"><input type="checkbox" checked={selected.includes(s.id)} disabled={!!busy} onChange={e=>setSelected(old=>e.target.checked?[...old,s.id]:old.filter(id=>id!==s.id))}/><strong>{s.label}</strong></div><p className="inspiration-pattern">{s.pattern}</p><div><b>用于当前广告</b><p>{s.adaptation}</p></div>{s.caution&&<small>复用边界：{s.caution}</small>}{s.testHypothesis&&<small>可验证假设：{s.testHypothesis}</small>}</label>)}</div>
        <p className="inspiration-notice">{analysis.limitations}</p><div className="reference-destination"><Field label="导入到创作方案"><select aria-label="参考应用目标" className="input" value={targetConceptId} disabled={!!busy||locked} onChange={e=>setTargetConceptId(e.target.value)}><option value="">生成新的参考方案</option>{project.concepts.map(c=><option key={c.id} value={c.id}>基于「{c.title}」生成参考版</option>)}</select></Field><p>{locked?'当前核心创意已锁定；新的参考创意请在新项目中导入。':'导入后自动选中新方案。参考方法同步进入分镜与视频指令；原方案和已生成素材保留。'}</p></div><div className="inspiration-apply"><p>已选 {selected.length} 项参考点，将作为这份方案的创作指导。</p><button className="btn-primary" disabled={!!busy||!selected.length||locked} onClick={apply}>{busy==='apply'?<><Spinner/> 正在融入创作方案…</>:locked?'当前创意已锁定':'一键导入创作方案 →'}</button></div></>:<EmptyHint>上传视频后自动拆解脚本，查看爆款点，再选择要带入方案的参考方法。</EmptyHint>}
    </article>}</div>}
    <Modal open={showForm} title={editing?'编辑视频参考':'导入视频参考'} onClose={()=>!saving&&setShowForm(false)} wide><form onSubmit={save} className="inspiration-import space-y-4">
      <p className="inspiration-source">上传视频即可自动识别画面、字幕和声音，无需手动整理脚本。热度与投放指标可留空。</p>
      <div className="reference-upload"><Field label="上传参考视频" hint="MP4 / MOV / WebM，最大 14 MB。视频发送给已配置的 Gemini 分析。"><input aria-label="上传参考视频" type="file" accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm" disabled={saving||!library?.videoAnalysisAvailable} onChange={e=>{const file=e.target.files?.[0]||null;setVideoFile(file);if(file&&!form.title)setForm({...form,title:file.name.replace(/\.[^.]+$/,'')})}}/></Field>{videoFile?<p>待上传：{videoFile.name}</p>:editing&&library?.items.find(r=>r.id===editing)?.video?<p>已保存视频，可选择新文件替换。</p>:null}{!library?.videoAnalysisAvailable&&<p className="inspiration-notice">需配置 Vertex Gemini 才能直接分析视频。当前仍可粘贴脚本拆解。</p>}</div>
      <Field label="视频标题 *"><input aria-label="视频参考标题" className="input" required maxLength={120} value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></Field>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3"><Field label="平台 *"><select aria-label="导入平台" className="input" value={form.platform} onChange={e=>setForm({...form,platform:e.target.value})}>{library?.platforms.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="行业 *"><select aria-label="导入行业" className="input" value={form.industry} onChange={e=>setForm({...form,industry:e.target.value})}>{library?.industries.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="内容类型"><select aria-label="导入内容类型" className="input" value={form.contentType} onChange={e=>setForm({...form,contentType:e.target.value,ctr:'',cvr:'',cpa:''})}><option value="organic">自然内容</option><option value="ad">信息流广告</option></select></Field></div>
      <Field label="原视频链接"><input aria-label="原视频链接" className="input" type="url" placeholder="https://…" value={form.sourceUrl} onChange={e=>setForm({...form,sourceUrl:e.target.value})}/></Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><Field label="创作者 / 品牌"><input aria-label="参考创作者" className="input" value={form.creator} onChange={e=>setForm({...form,creator:e.target.value})}/></Field><Field label="场景 / 人群关键词"><input aria-label="参考关键词" className="input" placeholder="通勤、下班、雨天" value={form.tags} onChange={e=>setForm({...form,tags:e.target.value})}/></Field></div>
      <Field label="补充脚本 / 口播 / 字幕（选填）" hint="已上传视频可留空；仅文本拆解需至少 20 字"><textarea aria-label="导入脚本" className="input min-h-[100px]" maxLength={24000} value={form.script} onChange={e=>setForm({...form,script:e.target.value})}/></Field>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{Object.entries(metricLabels).filter(([k])=>form.contentType==='ad'||!['ctr','cvr','cpa'].includes(k)).map(([k,label])=><Field key={k} label={label}><input aria-label={'导入'+label} className="input" inputMode="decimal" placeholder="未提供" value={form[k as keyof typeof metricLabels]} onChange={e=>setForm({...form,[k]:e.target.value})}/></Field>)}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><Field label="发布日期"><input aria-label="参考发布日期" type="date" className="input" value={form.publishedAt} onChange={e=>setForm({...form,publishedAt:e.target.value})}/></Field><Field label="数据统计日期" hint="填写指标时必填"><input aria-label="参考统计日期" type="date" className="input" value={form.observedAt} onChange={e=>setForm({...form,observedAt:e.target.value})}/></Field></div>
      <Field label="数据来源说明" hint="填写指标时必填"><input aria-label="数据来源说明" className="input" placeholder="例如：原视频页面公开计数，2026-10-11 手动记录" value={form.sourceNote} onChange={e=>setForm({...form,sourceNote:e.target.value})}/></Field>
      <label className="flex gap-2 text-sm items-center"><input type="checkbox" checked={form.isDemo} onChange={e=>setForm({...form,isDemo:e.target.checked})}/>这是演示 / 测试数据（只进入结构示例）</label>
      <label className="flex gap-2 text-sm items-center"><input type="checkbox" checked={autoAnalyze} disabled={saving} onChange={e=>setAutoAnalyze(e.target.checked)}/>保存后自动拆解并提炼参考点</label>
      {formError&&<p role="alert" className="inspiration-error">{formError}</p>}<div className="flex gap-3 justify-end"><button type="button" className="btn-ghost" disabled={saving} onClick={()=>setShowForm(false)}>取消</button><button type="submit" className="btn-primary" disabled={saving}>{saving&&<Spinner/>}{saving?saveStage:autoAnalyze?'保存并自动拆解':'保存参考'}</button></div>
    </form></Modal>
  </Section>
}
