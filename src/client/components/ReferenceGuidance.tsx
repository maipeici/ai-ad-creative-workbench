import type { InspirationAttribution } from '../inspiration-types'
import '../styles/inspiration.css'

export default function ReferenceGuidance({reference,stage='concept'}:{reference?:InspirationAttribution|null;stage?:'concept'|'storyboard'|'video'}) {
  if(!reference)return null
  if(!reference.guidance?.length)return <div className="reference-guidance"><strong>参考来源 · {reference.title}</strong><p>{reference.summary}。这是旧版来源记录；请重新拆解并导入参考，以补齐后续分镜与视频的创作指导。</p></div>
  return <div className="reference-guidance">
    <div className="reference-guidance-title"><span>{reference.inputKind==='video'?'视频参考已带入':'脚本参考已带入'}</span><strong>{reference.title}</strong></div>
    <div className="reference-flow" aria-label="参考传递流程">{['视频拆解','创意方案','分镜脚本','视频产出'].map((label,i)=><span key={label} className={i<=({concept:1,storyboard:2,video:3}[stage])?'ready':''}>{i+1} · {label}{i<3?' →':''}</span>)}</div>
    <p>{stage==='concept'?'所选方法会随方案进入分镜，并写入对应镜头的视频生成指令。':stage==='storyboard'?'每个镜头标明参考的时间段和改写方式，生成画面与视频时继续沿用。':'本次视频沿用分镜中已确认的参考方法、镜头动作与节奏。'}</p>
    {reference.adaptedFromTitle&&<p>基于方案「{reference.adaptedFromTitle}」生成的参考版，原方案保留。</p>}
    <details><summary>查看参考创作指导 · {reference.guidance?.length||reference.suggestionIds.length} 项</summary>
      {reference.guidance?.length?reference.guidance.map(s=><div className="reference-method" key={s.id}><strong>{s.label}</strong><p>{s.adaptation}</p>{s.caution&&<small>边界：{s.caution}</small>}</div>):<p>{reference.summary}。此方案来自旧版拆解，重新应用参考可补齐完整指导。</p>}
      {reference.sourceUrl&&<a className="inspiration-link" href={reference.sourceUrl} target="_blank" rel="noopener noreferrer">查看原视频 ↗</a>}
    </details>
  </div>
}
