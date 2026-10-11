import { useEffect, useState } from 'react'
import type { PhaseProps } from '../App'
import type { Project } from '../types'
import { api } from '../api'
import { Modal, Section } from '../ui'
import BatchPanel from '../components/BatchPanel'
import FinalQualityPanel from '../components/FinalQualityPanel'

export default function Phase5Review(props:PhaseProps){
  const {project,meta,patch,setProject,notify,goto,gotoFoundation,preview}=props
  const [detail,setDetail]=useState<Project|null>(null),[saving,setSaving]=useState(false)
  const saved=(project.review?.requirements||[]).filter(r=>!meta.reviewChecklist.includes(r))
  const [text,setText]=useState(saved.join('\n'))
  useEffect(()=>{setText(saved.join('\n'))},[project.id,JSON.stringify(saved)])
  const requirements=[...new Set(text.split('\n').map(s=>s.trim()).filter(Boolean))]
  const dirty=JSON.stringify(requirements)!==JSON.stringify(saved)
  const refresh=async(p:Project)=>{setDetail(p);try{setProject(await api.getProject(project.id))}catch(e:any){notify(e.message,'error')}}
  const editVideo=(p:Project)=>{setDetail(null);void props.inspectVideo?.(p.id)}
  const panel=(p:Project)=><><video className="w-44 rounded-lg bg-black mb-4" src={p.render.finalVideo?.url} controls preload="metadata"/><FinalQualityPanel project={p} onUpdate={updated=>void refresh(updated)} notify={notify} goto={phase=>{setDetail(null);if(phase===6)editVideo(p);else void props.openMaterial?.(p.id,phase)}}/></>
  if(preview)return <FinalQualityPanel project={project} onUpdate={setProject} notify={notify} goto={goto}/>
  return <>
    <details className="stage-disclosure"><summary>审核依据与项目补充要求</summary><Section title="同一套标准，统一检查成片" desc="品牌和平台规则自动载入，只在品牌素材的合规边界说明维护。">
      <div className="review-rule-line">{[['brand','品牌要求'],['platform','平台规则'],['production','制作与创意要求']].map(([group,label])=><span key={group}>{label} {project.reviewPolicy?.rules.filter(r=>r.group===group).length||0} 项</span>)}<button className="text-link" onClick={()=>gotoFoundation?.('compliance')}>查看规则与来源 →</button></div>
      {project.reviewPolicy?.rules.some(r=>r.requiredInput)&&<p className="foundation-notice">所选平台规则待补充，当前无法判定审核通过。</p>}
      <label className="label mt-4" htmlFor="final-review-requirements">项目额外要求（可选）</label><textarea id="final-review-requirements" aria-label="项目额外要求" className="input min-h-24" value={text} disabled={saving} onChange={e=>setText(e.target.value)}/><button className="btn-ghost mt-3" disabled={!dirty||saving||requirements.length>30||requirements.some(r=>r.length>300)} onClick={async()=>{setSaving(true);try{await patch({review:{requirements}});notify('补充要求已保存，成片需按新要求复检')}catch(e:any){notify(e.message,'error')}finally{setSaving(false)}}}>保存补充要求</button>
    </Section></details>
    {project.experimentLink ? panel(project) : <BatchPanel project={project} phase={5} audit onOpen={async(id,phase)=>{if(phase===5){try{setDetail(await api.getProject(id))}catch(e:any){notify(e.message,'error')}}else return props.openMaterial?.(id,phase)}} onUpdate={setProject} notify={notify} beforeOpen={async()=>{if(dirty)throw new Error('请先保存项目补充要求，再开始审核')}} onExperiment={props.openExperiments}/>}
    <Modal open={!!detail&&!project.experimentLink} drawer title={detail?.creativeName||'成片审核详情'} onClose={()=>setDetail(null)}>{detail&&panel(detail)}</Modal>
  </>
}
