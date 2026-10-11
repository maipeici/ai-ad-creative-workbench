import { useState } from 'react'
import { api } from '../api'
import type { Project } from '../types'
import { Badge, Section, Spinner } from '../ui'

export default function FinalQualityPanel({ project, onUpdate, notify, goto }: { project: Project; onUpdate: (project: Project) => void; notify: (message: string, tone?: 'error' | 'ok') => void; goto: (phase: number) => void }) {
  const [busy, setBusy] = useState(false)
  const review = project.render.qualityReview
  const labels: Record<string, string> = { passed: '成片质检通过', blocked: '发现问题', 'needs-input': '需补充或重试', stale: '成片已变更 · 待复检' }
  return <Section title="成片质检" desc="生成后自动检查实际画面、声音与字幕，并按同一套品牌和平台规则核对成片。有问题时查看定位和修复建议。" right={<Badge tone={review?.status === 'passed' ? 'green' : 'amber'}>{review ? labels[review.status] : '尚未检查实际视频'}</Badge>}>
    {project.render.finalVideo?.stale && <p className="business-context mb-4">需求、脚本或镜头已变更，当前展示的是旧成片。请先完成自动审核与重新合成，再进行质检或下载最新交付包。</p>}
    <div className="flex gap-3 flex-wrap"><button className="btn-primary" disabled={busy || !project.render.finalVideo || project.render.finalVideo.stale} onClick={async () => { setBusy(true); try { const updated = await api.reviewFinalVideo(project.id); onUpdate(updated); notify(updated.render.qualityReview?.status === 'passed' ? '成片质检通过' : '质检完成，请查看逐项结果') } catch (e: any) { notify(e.message, 'error') } finally { setBusy(false) } }}>{busy && <Spinner />}{busy ? '正在检查画面与声音…' : review ? '重新检查成片' : '运行成片质检'}</button>{review && ['blocked', 'needs-input', 'stale'].includes(review.status) && <button className="btn-ghost" onClick={() => goto(4)}>修改问题镜头 →</button>}
</div>
    {review && <details className="mt-4" open={review.status !== 'passed'}><summary>{review.status === 'passed' ? '查看质检明细' : '查看待处理问题与检查依据'}</summary><div className="quality-results">{review.results.map(item => <div className="quality-result" key={item.id}><div className="flex gap-3 items-center"><Badge tone={review.status === 'stale' ? 'slate' : item.status === 'pass' ? 'green' : item.status === 'block' ? 'red' : 'amber'}>{review.status === 'stale' ? '待复检' : item.status === 'pass' ? '通过' : item.status === 'block' ? '需修复' : '待确认'}</Badge><strong>{item.label}</strong><span className="text-xs text-slate-400">{item.timing}</span></div><p>{item.evidence}</p>{item.suggestion && <p>建议：{item.suggestion}</p>}</div>)}</div></details>}
  </Section>
}
