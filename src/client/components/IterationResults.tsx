import type { ExperimentReport } from '../types'
import { Badge, Section } from '../ui'
import type { PerformanceVersion } from '../demo/iteration-demo'

export const formatNumber=(n:number|null|undefined)=>n==null?'—':n.toLocaleString('zh-CN',{maximumFractionDigits:2})
export const formatMetric=(n:number|null,key:string)=>n==null?'—':key==='cpa'?'¥'+n.toFixed(2):key==='roas'?n.toFixed(2):(n*100).toFixed(2)+'%'
const versionName=(v:PerformanceVersion)=>{const prefix=[v.label+' · ',v.label+' '].find(p=>v.name.startsWith(p));return prefix?v.name.slice(prefix.length):v.name}
export function remixAvailability(v:PerformanceVersion,metric:string,demo:boolean){
  if(!v.available)return '素材已移除'
  if(v.staleData||v.staleVideo)return '需更新素材数据'
  if(!v.hasData)return v.parentProjectId?'待制作 / 待投放':'等待投放数据'
  if(!demo&&!v.videoUrl)return '请先完成成片'
  if(v.totals.impressions<1000||v.totals.clicks<100||(metric!=='ctr'&&v.totals.conversions<20))return '样本较少，继续观察'
  return ''
}
type Props={report?:ExperimentReport;rows:PerformanceVersion[];demo:boolean;busy:boolean;onRemix:(id:string,instruction?:string,variable?:string)=>void;onOpen:(id:string)=>void;onImport:()=>void;onSetup:()=>void}

export default function IterationResults({report,rows,demo,busy,onRemix,onOpen,onImport,onSetup}:Props){
  const parentLabel=(v:PerformanceVersion)=>rows.find(p=>p.projectId===v.parentProjectId)?.label||v.parentProjectId?.slice(0,8)||'—'
  const primary=report?.primaryMetric||'cpa'
  const candidates=rows.filter(v=>v.hasData||!v.parentProjectId)
  const drafts=rows.filter(v=>v.available&&!v.hasData&&report?.iterations.some(i=>i.projectId===v.projectId))
  return <>
    <Section title="01 · 素材效果对比" desc="把同一素材的点击、转化和成本放在一起；父版本与变化列说明每一轮改了哪里。" right={<Badge tone={demo?'amber':'blue'}>{demo?'演示数据':rows.some(v=>v.hasData)?'真实导入':'待导入数据'} · {report?.plan.attribution||'等待关联数据'}</Badge>}>
      {report?<><div className="iteration-table-scroll" role="region" aria-label="素材效果对比表，可横向滚动" tabIndex={0}><table className="performance-table"><thead><tr>{['视频版本','父版本','本轮变化','曝光','点击','CTR','消耗','转化','CVR','CPA','ROAS','状态','操作'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(v=>{
        const blocked=remixAvailability(v,primary,demo)
        return <tr key={v.projectId} className={v.parentProjectId&&!v.hasData?'new-revision-row':''}>
          <td><button className="version-name" onClick={()=>onOpen(v.projectId)} disabled={!v.available}><span>{v.label}</span>{versionName(v)}</button><small>{v.adCreativeIds?.join(' / ')||'平台 ID 待关联'}</small></td>
          <td>{v.parentProjectId?'← '+parentLabel(v):'—'}</td><td>{v.changeSummary||'初始版本'}</td>
          <td>{v.hasData?formatNumber(v.totals.impressions):'—'}</td><td>{v.hasData?formatNumber(v.totals.clicks):'—'}</td><td className="metric-focus">{formatMetric(v.metrics.ctr,'ctr')}</td>
          <td>{v.hasData?'¥'+formatNumber(v.totals.spend):'—'}</td><td>{v.hasData?formatNumber(v.totals.conversions):'—'}</td><td>{formatMetric(v.metrics.cvr,'cvr')}</td><td className="metric-focus">{formatMetric(v.metrics.cpa,'cpa')}</td><td>{formatMetric(v.metrics.roas,'roas')}</td>
          <td><Badge tone={!blocked?'green':v.hasData?'amber':'slate'}>{!blocked?'可作母版':v.available&&!v.hasData&&!v.staleVideo?(v.videoUrl?'待投放数据':'待制作'):blocked}</Badge></td>
          <td>{drafts.some(d=>d.projectId===v.projectId)?<button className="btn-ghost" onClick={()=>onOpen(v.projectId)}>{demo?'查看脚本':'继续制作'}</button>:<button className="btn-ghost" disabled={busy||!!blocked} title={blocked||'选择要修改的一个镜头'} onClick={()=>onRemix(v.projectId)}>二次创作</button>}</td>
        </tr>
      })}</tbody></table></div><p className="iteration-footnote">CTR = 点击 / 曝光 · CVR = 转化 / 点击 · CPA = 消耗 / 转化 · ROAS = 成交金额 / 消耗（非利润）</p><details className="iteration-sources"><summary>查看统计区间与数据来源</summary>{rows.filter(v=>v.hasData).map(v=><p key={v.projectId}>{v.label}：{v.periods.join('；')} · {v.sources.join('；')} · 成交金额 ¥{formatNumber(v.totals.revenue)}</p>)}</details></>:<div className="iteration-empty"><strong>先把投放结果关联到具体视频</strong><p>导入曝光、点击、转化和消耗，才能比较各个版本的表现。</p><button className="btn-primary" onClick={onImport}>导入投放数据</button><button className="text-link" onClick={onSetup}>选择已有视频 →</button></div>}
    </Section>
    <Section title="02 · 二次创作" desc="选一个有数据依据的母版，只改开头或结尾 CTA，其余镜头复用，减少重新制作的成本。" right={<Badge tone="brand">保留母版 · 只改一处</Badge>}>
      {candidates.length?<div className="remix-library">{candidates.map(v=>{
        const blocked=remixAvailability(v,primary,demo),suggestion=report?.insights.find(i=>i.projectId===v.projectId&&i.nextAction)
        return <article key={v.projectId} className={'remix-card '+(blocked?'unavailable':'')}><header><span className="remix-version">{v.label}</span><div><h4>{v.name}</h4><p>{blocked||'数据可参考 · 可选为母版'}</p></div><Badge tone={blocked?'amber':'green'}>{blocked?'待观察':'可二创'}</Badge></header><div className="remix-card-metrics"><span>CTR<strong>{formatMetric(v.metrics.ctr,'ctr')}</strong></span><span>CPA<strong>{formatMetric(v.metrics.cpa,'cpa')}</strong></span><span>转化<strong>{v.hasData?formatNumber(v.totals.conversions):'—'}</strong></span></div><p className="remix-card-hint">{blocked?'补齐有效样本后，再判断是否值得沿用。':suggestion?.nextAction||'沿用这一版的创意和固定镜头，选一个部位继续验证。'}</p><button className={blocked?'btn-ghost':'btn-primary'} disabled={busy||!!blocked} onClick={()=>onRemix(v.projectId,suggestion?.nextAction,suggestion?.variable)}>{blocked?'暂不作为母版':'以此版为母版二次创作 →'}</button></article>
      })}</div>:<div className="iteration-empty"><strong>有了效果数据，这里会出现可选母版</strong><p>也可以先切换上方“演示体验”，体验从母版到二创版本的完整操作。</p></div>}
      {!!drafts.length&&<div className="remix-created" role="status"><strong>已产生 {drafts.length} 个二次创作版本</strong><p>{demo?'演示草稿已加入上方版本表，可查看修改后的脚本。':'版本已加入当前项目，继续制作变化镜头并完成审核，再关联下一轮结果。'}</p><div>{drafts.map(v=><button key={v.projectId} className="btn-ghost" onClick={()=>onOpen(v.projectId)}>{v.label} ← {parentLabel(v)} · {demo?'查看二创脚本':'继续制作'} →</button>)}</div></div>}
    </Section>
    <Section title="03 · 下一轮迭代建议" desc="每条建议都给出数据依据和具体修改范围；先提出假设，再用下一轮投放验证。">
      {report?.insights.length?<div className="iteration-recommendations">{report.insights.map(i=><article key={i.projectId} className={i.status==='hypothesis'?'actionable':''}><div className="recommendation-copy"><div><Badge tone={i.status==='hypothesis'?'green':'amber'}>{i.label}</Badge><h4>{i.title}</h4></div><p>{i.evidence}</p>{i.nextAction&&<p className="recommendation-action">下一步：{i.nextAction}</p>}</div>{i.nextAction&&<button className="btn-ghost" disabled={busy||!rows.find(v=>v.projectId===i.projectId)||!!remixAvailability(rows.find(v=>v.projectId===i.projectId)!,primary,demo)} onClick={()=>onRemix(i.projectId,i.nextAction,i.variable)}>按此建议二创 →</button>}</article>)}</div>:<div className="iteration-empty"><p>导入数据后，建议会说明：参考哪一版、保留什么、下一轮只改哪里。</p></div>}
      <details className="iteration-sources"><summary>建议的判断边界</summary><p>至少 1,000 曝光、100 点击；关注 CVR / CPA 时另需 20 次转化，才开放基于效果的母版推荐。这只是观察门槛，不是统计显著性。还需确认人群、预算、版位、统计周期与分流条件一致。多项同时变化时不归因到某一个因素。</p></details>
    </Section>
  </>
}
