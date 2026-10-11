import { useState } from 'react'
import type { Project } from '../types'
import { Field } from '../ui'

export const performanceMetrics:Record<string,string>={ctr:'点击率 CTR',cvr:'点击转化率 CVR',cpa:'转化成本 CPA'}
export const performanceModes:Record<string,string>={tracking:'投放记录',comparison:'多素材对比','single-variable':'单变量测试'}

export default function IterationSetup({project,busy,onCreate,onOpen}:{project:Project;busy:boolean;onCreate:(input:Record<string,unknown>)=>void;onOpen:()=>void}){
  const [picked,setPicked]=useState<string[]>([])
  const [form,setForm]=useState({mode:'tracking',title:'',variable:'hook',primaryMetric:'ctr',hypothesis:'记录同一创意各视频的投放表现，寻找下一轮修改方向',audience:project.brief.audience,budget:'',period:'',attribution:'点击后 7 天，仅统计点击归因转化',trafficMethod:'observational'})
  return <>
    <p className="business-help">先选择本轮投放的视频，再下载已填好素材 ID 的 CSV 模板。一条视频也能开始记录。</p>
    <div className="iteration-modes mt-4">{Object.entries(performanceModes).map(([id,label])=><button key={id} className={form.mode===id?'chip-on':'chip-off'} disabled={busy} onClick={()=>setForm({...form,mode:id})}>{label}</button>)}</div>
    <div className="test-material-options mt-4">{project.batch?.items.map(item=><label key={item.id} className={picked.includes(item.id)?'selected':''}><input type="checkbox" disabled={!item.videoUrl||item.stale||busy} checked={picked.includes(item.id)} onChange={e=>setPicked(e.target.checked?[...picked,item.id]:picked.filter(id=>id!==item.id))}/><strong>{item.name}</strong><span>{item.videoUrl&&!item.stale?'已有成片':item.stale?'成片需更新':'尚无成片'}</span></label>)}</div>
    {!project.batch?.items.some(i=>i.videoUrl&&!i.stale)&&<p className="business-help mt-3">先完成视频制作与审核，再关联投放结果。<button className="text-link" onClick={onOpen}>返回视频制作 →</button></p>}
    <div className="business-form-grid mt-5">
      <Field label="记录名称"><input aria-label="记录名称" className="input" placeholder="例如：通勤广告 · 第一轮投放" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></Field>
      <Field label="主要关注指标"><select aria-label="主要关注指标" className="input" value={form.primaryMetric} onChange={e=>setForm({...form,primaryMetric:e.target.value})}>{Object.entries(performanceMetrics).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></Field>
      <Field label="本轮想了解什么？"><textarea aria-label="本轮想了解什么" className="input" value={form.hypothesis} onChange={e=>setForm({...form,hypothesis:e.target.value})}/></Field>
      <Field label="归因口径"><input aria-label="归因口径" className="input" value={form.attribution} onChange={e=>setForm({...form,attribution:e.target.value})}/></Field>
      {form.mode==='single-variable'&&<Field label="只改变哪部分？"><select aria-label="只改变哪部分" className="input" value={form.variable} onChange={e=>setForm({...form,variable:e.target.value})}><option value="hook">开头内容</option><option value="cta">结尾行动引导</option></select></Field>}
    </div>
    <details className="business-disclosure mt-4"><summary>补充投放条件</summary><div className="business-form-grid">{[['audience','目标人群'],['budget','预算分配'],['period','投放周期']].map(([key,label])=><Field key={key} label={label}><input aria-label={label} className="input" value={form[key as 'audience'|'budget'|'period']} onChange={e=>setForm({...form,[key]:e.target.value})}/></Field>)}<Field label="分流方式"><select aria-label="分流方式" className="input" value={form.trafficMethod} onChange={e=>setForm({...form,trafficMethod:e.target.value})}><option value="observational">常规投放观察</option><option value="platform-split">平台实验分流（需实际配置）</option></select></Field></div></details>
    <button className="btn-primary mt-5" disabled={busy||picked.length<(form.mode==='comparison'?2:1)||!form.hypothesis.trim()||!form.attribution.trim()} onClick={()=>onCreate({...form,creativeIds:picked})}>关联 {picked.length} 条素材并继续导入</button>
  </>
}
