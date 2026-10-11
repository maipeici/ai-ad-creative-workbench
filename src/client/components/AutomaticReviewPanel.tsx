import { useEffect, useState } from 'react'
import type { Meta, Project } from '../types'
import { Badge, Section, Spinner } from '../ui'

export default function AutomaticReviewPanel({ project, meta, patch, runReview, busy, goto, notify }: {
  project: Project
  meta: Meta
  patch: (p: Record<string, unknown>) => Promise<void>
  runReview: (requirements: string[], autoRepair: boolean) => Promise<void>
  busy: boolean
  goto: (phase: number) => void
  notify: (message: string, tone?: 'error' | 'ok') => void
}) {
  const saved = project.review?.requirements || meta.reviewChecklist
  const [text, setText] = useState(saved.join('\n'))
  const [autoRepair, setAutoRepair] = useState(!project.experimentLink)
  const [saving, setSaving] = useState(false)
  useEffect(() => { setText(saved.join('\n')) }, [project.id, JSON.stringify(saved)])
  const requirements = [...new Set(text.split('\n').map(line => line.trim()).filter(Boolean))]
  const valid = requirements.length > 0 && requirements.length <= 30 && requirements.every(line => line.length <= 300)
  const dirty = JSON.stringify(requirements) !== JSON.stringify(saved)
  const review = project.review
  const stale = review.status === 'stale' || dirty
  const passed = review.approved && !stale
  const labels: Record<string, string> = { passed: '自动审核通过', blocked: '发现阻断项', 'needs-input': '待补充资料或重试', stale: '内容已变更 · 待复检', idle: '待运行' }
  const save = async () => {
    setSaving(true)
    try { await patch({ review: { requirements } }); notify('审核清单已保存') }
    catch (error: any) { notify(error.message, 'error') }
    finally { setSaving(false) }
  }
  return (
    <Section title="自动审核 Agent · 脚本预检" desc="检查生成前的分镜、文案和素材引用。成片的实际画面与声音在制作完成后单独质检。"
      right={<Badge tone={passed ? 'green' : busy ? 'brand' : 'amber'}>{busy ? '执行中' : dirty ? '清单有未保存修改' : labels[review.status || 'idle']}</Badge>}>
      <div className="review-pipeline">
        <div><strong>01 · 读取审核要求</strong><p>结合品牌资料、营销事实和渠道规格逐项检查。</p></div>
        <div><strong>02 · 自动修复与复检</strong><p>修正文案和制作方案，最多执行一轮 Agent 文本修复。</p></div>
        <div><strong>03 · 输出审核结果</strong><p>给出判断依据、修改记录和待补资料，全部通过后进入生成。</p></div>
      </div>
      <label className="label" htmlFor="review-requirements">本项目审核清单 <span className="text-slate-500 font-normal">每行一条，最多 30 条；所有条目均需通过</span></label>
      <textarea id="review-requirements" className="input min-h-[210px] leading-7 resize-y" value={text} disabled={busy || saving}
        onChange={event => setText(event.target.value)} />
      <div className="flex items-center justify-between gap-3 flex-wrap mt-3">
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={autoRepair} disabled={busy || !!project.experimentLink} onChange={event => setAutoRepair(event.target.checked)} className="accent-brand" />
          {project.experimentLink ? '实验固定项已锁定：仅预检，请在指定镜头手动修改问题' : '自动修复可处理的问题并复检'}
        </label>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-ghost !text-xs" disabled={busy || saving} onClick={() => setText(meta.reviewChecklist.join('\n'))}>恢复默认清单</button>
          <button className="btn-ghost !text-xs" disabled={!valid || !dirty || busy || saving} onClick={save}>{saving && <Spinner />}保存清单</button>
          <button className="btn-primary !text-xs" disabled={!valid || busy || saving || !project.storyboard?.shots.length}
            onClick={() => runReview(requirements, autoRepair)}>{busy && <Spinner />}{busy ? '检查、修复与复检中…' : '运行自动审核'}</button>
        </div>
      </div>
      {!valid && <p className="text-xs text-red-300 mt-3">请填写 1–30 条审核要求，每条不超过 300 字。</p>}
      {!project.storyboard?.shots.length && <p className="foundation-notice">审核清单可以先保存。完成分镜后即可运行自动审核。<button className="ml-3 text-brand" onClick={() => goto(4)}>去生成分镜 →</button></p>}
      <p className="text-[11px] text-slate-500 leading-relaxed mt-4">规则检查与 Agent 语义判断共同决定结果。真实视频画质与播放效果不在本阶段审核范围内。缺少模型连接或必要依据时会保持待处理状态。</p>
      {review.checkedAt && (
        <div className="mt-6 border-t border-ink-600 pt-5">
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <strong className="text-sm">{stale ? '上次审核结果（需重新审核）' : '逐项审核结果'}</strong>
            <span className="text-[11px] text-slate-500">{new Date(review.checkedAt).toLocaleString('zh-CN')} · {['gemini', 'llm'].includes(review.source || '') ? 'Agent + 规则引擎' : '规则引擎 · 语义审核未完成'}</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {(review.results || []).map(result => <div className="review-result" key={result.id}>
              <div className="flex items-start gap-2"><Badge tone={stale ? 'slate' : result.status === 'pass' ? 'green' : result.status === 'block' ? 'red' : 'amber'}>{stale ? '待复检' : result.status === 'pass' ? '通过' : result.status === 'block' ? '阻断' : '待补充'}</Badge><strong className="text-xs leading-6">{result.label}</strong></div>
              <p>{result.evidence}</p>
              {result.suggestion && result.status !== 'pass' && <p className="!text-amber-300">下一步：{result.suggestion}</p>}
            </div>)}
          </div>
          {passed && <div className="mt-5 flex items-center justify-between gap-3 flex-wrap"><p className="text-xs text-emerald-300">规则无阻断，审核清单全部通过。</p><button className="btn-primary" onClick={() => goto(6)}>下一步：生成视频 →</button></div>}
        </div>
      )}
    </Section>
  )
}
