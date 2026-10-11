import { useEffect, useState } from 'react'
import { api } from '../api'
import type { ExperimentReport, Project } from '../types'
import { Badge, Field, Modal, Spinner } from '../ui'
import { appendDemoIteration, createIterationDemo } from '../demo/iteration-demo'
import IterationResults from './IterationResults'
import IterationSetup, { performanceMetrics, performanceModes } from './IterationSetup'
import { performanceRows } from '../lib/performance-rows'
import '../styles/iteration.css'

type Props={project:Project;notify:(message:string,tone?:'error'|'ok')=>void;onOpen:(id:string,phase?:number)=>void;onUpdate:(p:Project)=>void}
type Revision={base:Project;reportId:string;demo:boolean;variable:string;instruction:string;actionCn:string;vo:string;subtitle:string}

export default function ExperimentPanel({project,notify,onOpen,onUpdate}:Props){
  const [items,setItems]=useState<ExperimentReport[]>([]),[selected,setSelected]=useState(''),[loading,setLoading]=useState(true)
  const [mode,setMode]=useState<'demo'|'real'>('real'),[demoState,setDemoState]=useState(()=>createIterationDemo(project))
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[dialog,setDialog]=useState<'import'|'setup'|null>(null)
  const [csv,setCsv]=useState(''),[conclusion,setConclusion]=useState(''),[nextAction,setNextAction]=useState('')
  const [revision,setRevision]=useState<Revision|null>(null),[previewId,setPreviewId]=useState('')
  const current=items.find(e=>e.id===selected),demo=mode==='demo'
  const shown=demo?demoState.report:current
  const rows=demo?demoState.report.versions:performanceRows(current,items)
  const preview=demoState.projects[previewId]

  const refresh=async(id?:string)=>{
    const reports=(await api.experiments()).filter(e=>e.parentId===project.id)
    setItems(reports);setSelected(previous=>id||(reports.some(e=>e.id===previous)?previous:reports[0]?.id||''))
  }
  useEffect(()=>{
    let live=true;setLoading(true);setError('');setDialog(null);setRevision(null);setPreviewId('');setDemoState(createIterationDemo(project))
    api.experiments().then(reports=>{
      if(!live)return
      const own=reports.filter(e=>e.parentId===project.id)
      setItems(own);setSelected(own.find(e=>e.versions.some(v=>v.hasData))?.id||own[0]?.id||'')
      setMode(own.some(e=>e.versions.some(v=>v.hasData))?'real':'demo')
    }).catch(e=>{if(live){setItems([]);setSelected('');setError(e.message)}}).finally(()=>live&&setLoading(false))
    return()=>{live=false}
  },[project.id])
  useEffect(()=>{setConclusion(current?.conclusion||'');setNextAction(current?.nextAction||'');setCsv('')},[selected])
  const run=async(key:string,work:()=>Promise<void>)=>{
    if(busy)return
    setBusy(key);setError('')
    try{await work()}catch(e:any){setError(e.message);notify(e.message,'error')}finally{setBusy('')}
  }
  const openImport=()=>{setMode('real');setDialog(current?'import':'setup');setError('')}
  const openSetup=()=>{setMode('real');setDialog('setup');setError('')}
  const prepare=(id:string,instruction?:string,requestedVariable?:string)=>void run('prepare',async()=>{
    const base=demo?demoState.projects[id]:await api.getProject(id)
    const source=demo?demoState.report:current?.versions.some(v=>v.projectId===id)?current:items.find(e=>e.id===current?.iterations.find(i=>i.projectId===id)?.experimentId)
    const suggestion=source?.insights.find(i=>i.projectId===id)
    const variable=requestedVariable||suggestion?.variable||'hook'
    const shot=variable==='cta'?base?.storyboard?.shots.at(-1):base?.storyboard?.shots[0]
    if(!shot||!source)throw new Error('母版或关联的投放记录不存在，请重新选择')
    setRevision({base,reportId:source.id,demo,variable,instruction:instruction||suggestion?.nextAction||'保持其他镜头不变，验证一种新的开头表达。',actionCn:shot.actionCn||'',vo:shot.vo||'',subtitle:shot.subtitle||''})
  })
  const changeVariable=(variable:string)=>{
    if(!revision)return
    const shot=variable==='cta'?revision.base.storyboard!.shots.at(-1)!:revision.base.storyboard!.shots[0]
    setRevision({...revision,variable,instruction:variable==='cta'?'保持开头与正文不变，验证新的结尾行动引导。':'保持正文与结尾不变，验证新的开头表达。',actionCn:shot.actionCn||'',vo:shot.vo||'',subtitle:shot.subtitle||''})
  }
  const original=revision&&(revision.variable==='cta'?revision.base.storyboard?.shots.at(-1):revision.base.storyboard?.shots[0])
  const changed=revision&&original&&(['actionCn','vo','subtitle'] as const).some(k=>revision[k].trim()!==(original[k]||'').trim())
  const saveRevision=()=>void run('iterate',async()=>{
    if(!revision)return
    const changes={actionCn:revision.actionCn,vo:revision.vo,subtitle:revision.subtitle}
    if(revision.demo){
      setDemoState(state=>appendDemoIteration(state,revision.base.id,revision.variable,revision.instruction,changes))
      notify('演示二创脚本已生成：上方表格可查看父版本与改动，真实项目未变更')
    }else{
      const result=await api.iterateFromPerformance(project.id,revision.reportId,{projectId:revision.base.id,variable:revision.variable,instruction:revision.instruction,changes})
      onUpdate(result.project);await refresh(selected)
      notify('二创版本已加入当前项目，固定镜头已复用，可继续制作变化镜头')
    }
    setRevision(null)
  })
  const saveNotes=()=>api.saveExperimentConclusion(project.id,current!.id,conclusion,nextAction)

  return <div className="iteration-page">
    <div className="iteration-intro"><div><h3>用投放结果，决定下一条视频怎么改</h3><p>看素材效果 → 选一个母版 → 只改一个变量 → 制作并验证下一版</p></div><button className="btn-primary" disabled={!!busy||loading} onClick={openImport}>↑ 导入投放数据</button></div>
    <div className="iteration-mode-bar"><div className="iteration-mode-switch" role="group" aria-label="投放数据模式"><button aria-pressed={demo} disabled={!!busy||loading} onClick={()=>{setMode('demo');setError('')}}>演示体验</button><button aria-pressed={!demo} disabled={!!busy||loading} onClick={()=>{setMode('real');setError('')}}>真实投放{items.some(e=>e.versions.some(v=>v.hasData))?' · 已有数据':''}</button></div><span>{demo?'先用示例走一遍二次创作流程':'关联广告后台导出的效果数据'}</span>{demo?<button className="text-link" disabled={!!busy} onClick={()=>{setDemoState(createIterationDemo(project));setPreviewId('');notify('演示已重置')}}>重置演示</button>:<button className="text-link" disabled={!!busy||loading} onClick={openSetup}>关联新一轮素材 →</button>}</div>
    {demo&&<div className="iteration-demo-notice"><Badge tone="amber">演示数据 · 非真实投放</Badge><p>下方 5 条示例素材用于演示效果对比与二次创作。二创脚本仅保留在当前页面，刷新后重置，不写入真实项目，也不调用生成模型。</p></div>}
    {error&&!dialog&&!revision&&<p role="alert" className="inspiration-error">{error}</p>}
    {loading?<p role="status"><Spinner/> 正在读取投放记录…</p>:<>
      {!demo&&current&&<div className="batch-toolbar"><label className="label !mb-0" htmlFor="iteration-record">当前投放记录</label><select id="iteration-record" className="input max-w-lg" value={selected} disabled={!!busy} onChange={e=>setSelected(e.target.value)}>{items.map(e=><option key={e.id} value={e.id}>{e.title}</option>)}</select><Badge tone="blue">{performanceModes[current.mode||'single-variable']} · {performanceMetrics[current.primaryMetric]}</Badge></div>}
      <IterationResults report={shown} rows={rows} demo={demo} busy={!!busy} onRemix={prepare} onOpen={id=>demo?setPreviewId(id):onOpen(id,6)} onImport={openImport} onSetup={openSetup}/>
      {!demo&&current&&<details className="business-disclosure"><summary>补充我的观察与下一轮计划</summary><div className="business-form-grid"><Field label="观察结论"><textarea aria-label="观察结论" className="input" value={conclusion} onChange={e=>setConclusion(e.target.value)}/></Field><Field label="下一轮计划"><textarea aria-label="下一轮计划" className="input" value={nextAction} onChange={e=>setNextAction(e.target.value)}/></Field></div><div className="batch-toolbar mt-4"><button className="btn-ghost" disabled={!!busy} onClick={()=>void run('save',async()=>{await saveNotes();await refresh(current.id);notify('观察与计划已保存')})}>保存观察</button><button className="text-link" disabled={!!busy||!nextAction.trim()} onClick={()=>void run('next',async()=>{await saveNotes();const p=await api.nextExperimentTask(project.id,current.id);onOpen(p.id,2)})}>用此计划探索新创意项目 →</button></div></details>}
    </>}

    <Modal open={!!dialog} title={dialog==='setup'?'关联本轮素材':'导入真实投放数据'} onClose={()=>!busy&&setDialog(null)} wide>
      {error&&<p role="alert" className="inspiration-error mb-4">{error}</p>}
      {dialog==='setup'?<IterationSetup project={project} busy={!!busy} onOpen={()=>{setDialog(null);onOpen(project.id,6)}} onCreate={input=>void run('create',async()=>{const result=await api.createExperiment(project.id,input);onUpdate(result.project);await refresh(result.experiment.id);setDialog('import');notify('素材已关联，请下载模板并填写实际投放数据')})}/>:current&&<>
        <p className="business-help">投放记录：{current.title}。素材 ID 已填入模板；从广告后台填写同口径的曝光、点击、转化和消耗，平台广告创意 ID 与成交金额可选。</p>
        <div className="batch-toolbar mt-5"><a className="btn-ghost" href={'/api/projects/'+project.id+'/experiments/'+current.id+'/template.csv'} download>1. 下载数据模板</a><label className="btn-ghost cursor-pointer">2. 选择填写好的 CSV<input type="file" className="sr-only" aria-label="选择投放数据 CSV" accept=".csv,text/csv" disabled={!!busy} onChange={e=>{const file=e.target.files?.[0];if(file){if(file.size>1024*1024)setError('文件不能超过 1 MB');else void file.text().then(setCsv).catch(e=>setError(e.message))}e.target.value=''}}/></label></div>
        <Field label="CSV 内容" hint="也可直接粘贴"><textarea className="input min-h-40 mt-3 font-mono text-xs" aria-label="投放数据 CSV" value={csv} onChange={e=>setCsv(e.target.value)}/></Field>
        <p className="business-help mt-3">口径：{current.plan.attribution}。相同区间覆盖更新，重叠区间拒绝累计。尚无有效成片的素材无法导入效果数据。</p>
        <button className="btn-primary mt-5" disabled={!!busy||!csv.trim()} onClick={()=>void run('import',async()=>{await api.importExperimentResults(project.id,current.id,csv);await refresh(current.id);setCsv('');setDialog(null);notify('数据已与视频版本关联，效果表和建议已更新')})}>{busy==='import'?<Spinner/>:null}3. 校验并导入</button>
      </>}
    </Modal>

    <Modal open={!!revision} title={revision?.demo?'演示 · 基于母版二次创作':'基于母版二次创作'} onClose={()=>!busy&&setRevision(null)} wide>
      {revision&&<>
        {error&&<p role="alert" className="inspiration-error mb-4">{error}</p>}
        <div className="revision-summary"><Badge tone={revision.demo?'amber':'brand'}>{revision.demo?'演示草稿':'真实项目'}</Badge><strong>母版：{revision.base.creativeName||revision.base.name}</strong><p>保留同一创意、人物与场景、时长和其他镜头，只替换 {revision.variable==='cta'?'结尾行动引导':'开头内容'}。</p></div>
        <div className="business-form-grid mt-5"><Field label="本轮只改哪里？"><select aria-label="本轮只改哪里" className="input" value={revision.variable} disabled={!!busy} onChange={e=>changeVariable(e.target.value)}><option value="hook">开头内容</option><option value="cta">结尾行动引导</option></select></Field><Field label="希望验证什么？"><textarea aria-label="希望验证什么" className="input" value={revision.instruction} onChange={e=>setRevision({...revision,instruction:e.target.value})}/></Field></div>
        <div className="revision-original"><strong>母版镜头 · {original?.titleCn}</strong><p>画面：{original?.actionCn||'未填写'}</p><p>口播：{original?.vo||'未填写'}</p><p>字幕：{original?.subtitle||'未填写'}</p></div>
        <div className="business-form-grid mt-4">{([['actionCn','新的画面描述'],['vo','新的口播'],['subtitle','新的字幕']] as const).map(([key,label])=><Field key={key} label={label}><textarea aria-label={label} className="input" disabled={!!busy} value={revision[key]} onChange={e=>setRevision({...revision,[key]:e.target.value})}/></Field>)}</div>
        {revision.demo&&<button className="text-link mt-3" onClick={()=>setRevision({...revision,vo:revision.variable==='cta'?'现在打开花小猪，输入目的地，查看这趟行程的预估价。':'加班到这么晚，回家的路还要来回换乘吗？',subtitle:revision.variable==='cta'?'打开花小猪，先看预估价':'晚下班，也想省心回家'})}>填入一组示例改法 →</button>}
        <p className="business-help mt-4">请至少修改一项镜头内容。{revision.demo?'这里生成可查看的演示脚本，不会生成视频或写入真实项目。':'创建后，去视频制作生成变化镜头并合成，再进行审核。创建版本本身不调用生成模型。'}</p>
        <button className="btn-primary mt-4" disabled={!!busy||!changed||!revision.instruction.trim()} onClick={saveRevision}>{busy==='iterate'?<Spinner/>:null}{revision.demo?'生成演示二创脚本':'创建二创版本'}</button>
      </>}
    </Modal>

    <Modal open={!!preview} title={preview?.iteration?'演示二创脚本 · '+preview.creativeName:'演示母版脚本 · '+preview?.creativeName} onClose={()=>setPreviewId('')} wide>
      {preview&&<><div className="revision-summary"><Badge tone="amber">演示脚本 · 尚未生成视频</Badge><p>{preview.iteration?'母版：'+demoState.projects[preview.iteration.parentProjectId]?.creativeName+'；'+preview.iteration.changeSummary+'。其余镜头已保留。':'这是用于演示二创流程的脚本，投放指标均为虚构示例。'}</p></div><div className="demo-script">{preview.storyboard?.shots.map((shot,i)=>{const changedShot=preview.iteration&&(preview.iteration.variable==='cta'?i===preview.storyboard!.shots.length-1:i===0);return <article key={shot.id} className={changedShot?'changed':''}><header><h4>{String(i+1).padStart(2,'0')} · {shot.titleCn}</h4><Badge tone={changedShot?'brand':'slate'}>{changedShot?'本轮修改':preview.iteration?'沿用母版':shot.durationSec+' 秒'}</Badge></header><p>画面：{shot.actionCn}</p><p>口播：{shot.vo}</p><p>字幕：{shot.subtitle}</p></article>})}</div></>}
    </Modal>
    {busy&&<p role="status" className="business-help"><Spinner/> 正在处理…</p>}
  </div>
}
