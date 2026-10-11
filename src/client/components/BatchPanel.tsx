import { useEffect, useRef, useState } from 'react'
import type { CreativeBatch, CreativeSummary, Project } from '../types'
import { api } from '../api'
import { Badge, Modal, Spinner } from '../ui'

const steps: Record<string,string> = {storyboard:'准备版本脚本',preflight:'生成前基础检查',render:'生成镜头',poll:'等待镜头',assemble:'合成成片',quality:'审核实际视频'}
const stageOf=(i:CreativeSummary)=>!i.shotCount?4:6
const statusOf=(i:CreativeSummary)=>i.stale?'成片待更新':i.videoUrl?i.deliverable?'审核通过':i.qualityStatus==='blocked'?'需修复':i.qualityStatus==='needs-input'?'待补充依据':'待自动审核':!i.shotCount?'待准备脚本':'待制作视频'
type Props={project:Project;phase:number;production?:boolean;audit?:boolean;ffmpeg?:boolean;onOpen:(id:string,phase?:number)=>Promise<boolean|void>;onUpdate:(p:Project)=>void;notify:(message:string,tone?:'error'|'ok')=>void;beforeOpen:()=>Promise<void>;onExperiment?:()=>void}

export default function BatchPanel({project,phase,production,audit,ffmpeg,onOpen,onUpdate,notify,beforeOpen,onExperiment}:Props){
  const root=project.batchId||project.id
  const [batch,setBatch]=useState<CreativeBatch|undefined>(project.batch)
  const [open,setOpen]=useState(false),[selected,setSelected]=useState<string[]>([]),[filter,setFilter]=useState('all'),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const wasRunning=useRef(false),updateRef=useRef(onUpdate);updateRef.current=onUpdate
  useEffect(()=>{setBatch(project.batch)},[project.batch])
  useEffect(()=>{setSelected([]);setOpen(false);setFilter('all');setError('');wasRunning.current=false},[root])
  const running=batch?.job?.status==='running'
  useEffect(()=>{
    let cancelled=false,timer:ReturnType<typeof setTimeout>
    const tick=async()=>{try{
      const next=await api.batch(root);if(cancelled)return
      const finished=wasRunning.current&&next.job?.status!=='running';wasRunning.current=next.job?.status==='running';setBatch(next)
      if(finished){const fresh=await api.getProject(project.id);if(!cancelled)updateRef.current(fresh)}
      if(!cancelled&&next.job?.status==='running')timer=setTimeout(tick,2500)
    }catch(e:any){if(!cancelled)setError(e.message)}}
    void tick();return()=>{cancelled=true;clearTimeout(timer)}
  },[root,project.id,project.updatedAt,open,running])
  if(!batch)return null
  if(!production&&!audit&&(batch.items.length<2||phase<4)&&!running)return null
  const board=production||audit,complete=batch.items.filter(i=>i.videoUrl&&!i.stale).length,passed=batch.items.filter(i=>i.deliverable)
  const attention=new Set(batch.job?.items.filter(i=>['attention','paused'].includes(i.status)).map(i=>i.id))
  const action=production?'produce':audit?'review':'storyboard'
  const eligible=batch.items.filter(i=>action==='storyboard'?!i.shotCount||i.scriptSource?.startsWith('mock'):action==='review'?i.videoUrl&&!i.stale&&!i.deliverable:i.shotCount&&(!i.videoUrl||i.stale))
  const selectedIds=selected.filter(id=>batch.items.some(i=>i.id===id))
  const runIds=selectedIds.length?selectedIds.filter(id=>eligible.some(i=>i.id===id)):eligible.map(i=>i.id)
  const downloads=selectedIds.length?passed.filter(i=>selectedIds.includes(i.id)):passed
  const visible=batch.items.filter(i=>filter==='all'||filter==='storyboard'&&!i.shotCount||filter==='review'&&i.videoUrl&&!i.stale&&!i.deliverable||filter==='passed'&&i.deliverable||filter==='produce'&&i.shotCount&&(!i.videoUrl||i.stale)||filter==='complete'&&i.videoUrl&&!i.stale||filter==='attention'&&(attention.has(i.id)||['blocked','needs-input'].includes(i.qualityStatus)))
  const openItem=async(item:CreativeSummary,target:number)=>{if(await onOpen(item.id,target)!==false)setOpen(false)}
  const run=async(ids=runIds)=>{setBusy(true);setError('');try{await beforeOpen();const job=await api.runBatch(root,ids,action);wasRunning.current=true;setBatch({...batch,job});notify(production?'批量制作已启动，成片完成后进入自动审核':audit?'成片审核已启动，每个版本独立判定':'任务已启动，可查看各版本进度')}catch(e:any){setError(e.message)}finally{setBusy(false)}}
  const content=<>
    {production&&<div className="production-heading"><div><div className="eyebrow">ONE IDEA · MULTIPLE VIDEOS</div><h2>一条创意，批量生成 {batch.items.length} 条视频</h2><p>{project.versionPlan?.concept.title||project.concepts.find(c=>c.id===project.selectedConceptId)?.title||'先确定核心创意'}</p></div><button className="btn-ghost" onClick={()=>void onOpen(root,4)}>设置脚本与版本数量 →</button></div>}
    {audit&&<div className="production-heading"><div><div className="eyebrow">REVIEW · DOWNLOAD</div><h2>自动审核 Agent</h2><p>统一检查实际视频的品牌要求、平台规则与画面声音质量。逐条通过，逐条交付。</p></div><button className="btn-ghost" onClick={()=>void onOpen(root,6)}>返回视频制作 →</button></div>}
    {board&&<div className="batch-stats">{(audit?[[complete,'当前成片'],[passed.length,'审核通过'],[eligible.length,'待审核 / 复检'],[batch.items.filter(i=>['blocked','needs-input'].includes(i.qualityStatus)).length,'需处理']]:[[batch.items.length,'视频版本'],[batch.items.filter(i=>i.shotCount).length,'已有脚本'],[complete,'已完成视频'],[batch.items.length-complete,'待完成视频']]).map(([value,label])=><div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>}
    <div className="production-actions"><div><button className="btn-primary" disabled={busy||running||!runIds.length||production&&!ffmpeg} onClick={()=>void run()}>{busy&&<Spinner/>}{running?'正在处理视频版本…':production?'批量生成视频（'+runIds.length+' 条）':audit?'审核成片（'+runIds.length+' 条）':'准备版本脚本（'+runIds.length+' 个）'}</button>{running&&<button className="btn-ghost" onClick={async()=>{try{await api.pauseBatch(root);notify('当前步骤完成后暂停，已有内容保留')}catch(e:any){setError(e.message)}}}>暂停任务</button>}</div><p>{production?'生成前自动检查脚本与素材是否就绪，再生成镜头、加入字幕配音并合成视频。完成后进入自动审核。':audit?'Agent 观看实际成片，对照品牌、平台规则及创意框架，提供时间定位和修复建议。':'按共用框架和允许变化项准备脚本，已有脚本保留。'}使用已配置的模型额度。</p></div>
    {production&&!ffmpeg&&<p className="foundation-notice" role="status">视频合成待配置：需先配置 FFmpeg，才能开始批量制作完整视频。</p>}
    {production&&batch.items.some(i=>!i.shotCount)&&<div className="production-prerequisites"><span>{batch.items.filter(i=>!i.shotCount).length} 个版本待准备脚本</span><button className="text-link" onClick={()=>void onOpen(root,4)}>准备脚本 →</button></div>}
    {audit&&complete===0&&<p className="business-context">先在视频制作完成至少一条视频，再运行审核。通过后可在本页打包下载。</p>}
    {audit&&<div className="delivery-actions"><div><strong>{passed.length} 条视频审核通过</strong><p>包含成片、可用封面、文案与审核报告。打包时排除未通过的版本。</p></div>{downloads.length>0?<a className="btn-primary" href={'/api/projects/'+root+'/batch/delivery.zip?ids='+downloads.map(i=>i.id).join(',')} download>打包下载{selectedIds.length?'所选通过视频':'全部通过视频'}（{downloads.length} 条）</a>:<button className="btn-primary" disabled>暂无可打包视频</button>}</div>}
    {error&&<p role="alert" className="inspiration-error">{error}</p>}
    {batch.job?.message&&<p role="status" className="business-help">{batch.job.message}</p>}
    <div className="material-filters" aria-label="筛选版本状态">{(audit?[['all','全部版本'],['review','待审核'],['passed','审核通过'],['attention','需处理']]:[['all','全部版本'],['storyboard','待脚本'],['produce','待制作'],['attention','需处理'],['complete','已有成片']]).map(([value,label])=><button key={value} className={filter===value?'chip-on':'chip-off'} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</button>)}</div>
    <div className="batch-toolbar"><button className="text-link" onClick={()=>setSelected(visible.map(i=>i.id))}>选择当前列表</button><button className="text-link" onClick={()=>setSelected([])}>清空选择</button><span>{selectedIds.length?'已选 '+selectedIds.length+' 个，'+runIds.length+' 个可执行':'默认处理所有可执行版本'}</span></div>
    {!visible.length&&<p className="business-empty">当前筛选下没有版本。</p>}
    <div className={board?'video-version-grid':'material-rows'}>{visible.map(item=>{
      const job=batch.job?.stage===action?batch.job.items.find(i=>i.id===item.id):undefined,problem=job?.status==='attention'||job?.status==='paused'
      return <article className={board?'video-version-card':'material-row'} key={item.id}>
        {board&&<div className="video-version-preview">{item.videoUrl?<video src={item.videoUrl} poster={item.cover||undefined} preload="none" controls playsInline/>:<div><span>{String(batch.items.findIndex(i=>i.id===item.id)+1).padStart(2,'0')}</span><strong>{job?.status==='running'?steps[job.step]||'准备中':statusOf(item)}</strong><small>{item.shotCount?item.readyShots+' / '+item.shotCount+' 个镜头已就绪':'脚本准备后可查看镜头进度'}</small></div>}</div>}
        <label className="material-row-name"><input type="checkbox" aria-label={'选择版本：'+item.name} checked={selectedIds.includes(item.id)} onChange={e=>setSelected(e.target.checked?[...selectedIds,item.id]:selectedIds.filter(id=>id!==item.id))}/><span><strong>{item.name}</strong>{!board&&<small>{statusOf(item)}</small>}</span></label>
        <Badge tone={problem?'amber':item.deliverable?'green':'slate'}>{job?.status==='running'?steps[job.step]||'准备中':problem?'需处理':statusOf(item)}</Badge>
        {item.instruction&&!audit&&<details className="version-instruction"><summary>本版本变化要求</summary><p>{item.instruction}</p></details>}
        <div className="version-card-actions"><button className="btn-ghost" onClick={()=>void openItem(item,audit&&item.videoUrl?5:board?stageOf(item):phase)}>{audit&&item.videoUrl?'查看审核与修复建议':board?!item.shotCount?'准备此版脚本':'查看成片与镜头':'打开此版本'}</button>{problem&&!running&&eligible.some(i=>i.id===item.id)&&<button className="text-link" disabled={busy||production&&!ffmpeg} onClick={()=>void run([item.id])}>重试此版本</button>}</div>
        {problem&&job?.message&&<p className="material-row-message">{job.message}</p>}
      </article>
    })}</div>
    {production&&complete>0&&<div className="delivery-actions"><div><strong>{complete} 条视频已完成</strong><p>下一步统一审核，审核通过后即可打包下载。</p></div><button className="btn-primary" onClick={()=>void onOpen(root,5)}>进入自动审核 →</button></div>}
  </>
  if(board)return <section className="production-board" aria-label={audit?'成片自动审核与下载':'批量视频制作'}>{content}</section>
  return <><div className="project-material-bar"><span>同一创意 · {batch.items.length} 个视频版本</span><label className="material-switcher"><span>当前版本</span><select aria-label="切换当前版本" value={project.id} onChange={e=>{const item=batch.items.find(i=>i.id===e.target.value);if(item)void openItem(item,phase)}}>{batch.items.map((item,i)=><option key={item.id} value={item.id}>{String(i+1).padStart(2,'0')} · {item.name}</option>)}</select></label>{running&&<span className="material-running"><Spinner/>处理中</span>}<button className="btn-ghost" onClick={async()=>{try{await beforeOpen();setBatch(await api.batch(root));setOpen(true)}catch(e:any){notify(e.message,'error')}}}>版本脚本</button></div><Modal open={open} drawer title="准备各版本脚本" onClose={()=>setOpen(false)}>{content}</Modal></>
}
