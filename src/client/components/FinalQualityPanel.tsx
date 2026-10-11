import { useState } from 'react'
import { api } from '../api'
import type { Project } from '../types'
import { Badge, Section, Spinner } from '../ui'

export default function FinalQualityPanel({ project, onUpdate, notify, goto }: { project: Project; onUpdate: (project: Project) => void; notify: (message: string, tone?: 'error' | 'ok') => void; goto: (phase: number) => void }) {
  const [busy, setBusy] = useState(false)
  const review = project.render.qualityReview
  const repair = async () => {
    setBusy(true)
    try {
      const result=await api.autofix(project.id,{})
      onUpdate(result.project)
      notify(result.report.applied.length ? '已修复 '+result.report.applied.length+' 处脚本规则问题，请重新合成后复检成片' : '没有可自动修复的脚本规则问题，请按审核建议调整镜头或素材')
    } catch(e:any) {notify(e.message,'error')} finally {setBusy(false)}
  }
  const labels: Record<string, string> = { passed: '自动审核通过', blocked: '发现问题', 'needs-input': '需补充或重试', stale: '成片已变更 · 待复检' }
  return <Section title="成片审核结果" desc="直接检查成片的品牌合规、平台规则及画面声音质量；通过后即可在本页下载。" right={<Badge tone={review?.status === 'passed' ? 'green' : 'amber'}>{review ? labels[review.status] : '尚未检查实际视频'}</Badge>}>
    {project.render.finalVideo?.stale && <p className="business-context mb-4">需求、脚本或镜头已变更，当前展示的是旧成片。请先修复并重新合成，再运行审核。</p>}
    <div className="flex gap-3 flex-wrap"><button className="btn-primary" disabled={busy || !project.render.finalVideo || project.render.finalVideo.stale} onClick={async () => { setBusy(true); try { const updated = await api.reviewFinalVideo(project.id); onUpdate(updated); notify(updated.render.qualityReview?.status === 'passed' ? '自动审核通过' : '审核完成，请查看逐项结果') } catch (e: any) { notify(e.message, 'error') } finally { setBusy(false) } }}>{busy && <Spinner />}{busy ? '正在检查画面与声音…' : review ? '重新检查成片' : '运行自动审核'}</button>{review && ['blocked', 'needs-input', 'stale'].includes(review.status) && <><button className="btn-ghost" onClick={() => goto(4)}>修改分镜内容 →</button><button className="btn-ghost" onClick={() => goto(6)}>修复画面、字幕与配音 →</button></>}
</div>
    {review&&['blocked','needs-input'].includes(review.status)&&!project.experimentLink&&<div className="mt-3"><button className="btn-ghost" disabled={busy} onClick={()=>void repair()}>修复可处理的脚本规则问题</button><p className="business-help">仅修复可确定的脚本与引用问题；画面与声音问题按建议回到视频制作调整，重新合成后再复检。</p></div>}
    {review?.status==='passed'&&!project.render.finalVideo?.stale&&<a className="btn-primary mt-4" href={'/api/projects/'+project.id+'/delivery.zip'} download>下载此条审核通过视频 ZIP</a>}
    {review && <details className="mt-4" open={review.status !== 'passed'}><summary>{review.status === 'passed' ? '查看审核明细' : '查看待处理问题与检查依据'}</summary><div className="quality-results">{review.results.map(item => <div className="quality-result" key={item.id}><div className="flex gap-3 items-center"><Badge tone={review.status === 'stale' ? 'slate' : item.status === 'pass' ? 'green' : item.status === 'block' ? 'red' : 'amber'}>{review.status === 'stale' ? '待复检' : item.status === 'pass' ? '通过' : item.status === 'block' ? '需修复' : '待确认'}</Badge><strong>{item.label}</strong><span className="text-xs text-slate-400">{item.timing}</span></div><p className="review-source">来源：{item.sourceUrl?<a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.source} ↗</a>:item.source||'成片质量'}</p><p>{item.evidence}</p>{item.suggestion && <p>建议：{item.suggestion}</p>}</div>)}</div></details>}
  </Section>
}
