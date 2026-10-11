import { useState } from 'react'
import type { PhaseProps } from '../App'
import { api } from '../api'
import { Badge, Field, Section, Spinner } from '../ui'

export const versionChanges: Record<string, string> = { casting: '人物外观与穿着', performance: '人物动作与表情', camera: '景别与运镜', setting: '同类场景环境', wording: '口播与字幕措辞（CTA 固定）' }

export default function VersionPlanPanel({ project, setProject, notify, openMaterial, goto }: PhaseProps) {
  const plan = project.versionPlan
  const existing = project.batch?.items.length || 1
  const [count, setCount] = useState(Math.max(existing, project.brief.deliveryCount || 4, 2))
  const [hook, setHook] = useState(plan?.hookStrategy || project.concepts.find(c => c.id === project.selectedConceptId)?.hook || '')
  const [notes, setNotes] = useState('')
  const [allowed, setAllowed] = useState(plan?.allowedChanges || ['casting', 'performance', 'camera'])
  const [instructions, setInstructions] = useState('')
  const [busy, setBusy] = useState(false)
  if (project.experimentLink) return null
  if (project.batchId) return <p className="business-context">当前是同一创意的视频版本。镜头顺序、时长、产品依据与 CTA 共用基础脚本。<button className="text-link" onClick={() => void openMaterial?.(project.batchId!, 4)}>查看基础脚本与版本范围 →</button></p>
  if (!project.storyboard?.shots.length) return null
  const create = async () => {
    setBusy(true)
    try {
      const next = await api.addCreatives(project.id, { versionCount: count, hookStrategy: hook, fixedNotes: notes, allowedChanges: allowed, instructions: instructions.split('\n') })
      setProject(next)
      notify(`已建立 ${count} 个同创意版本；接下来准备各版本脚本并审核`)
    } catch (error: any) { notify(error.message, 'error') } finally { setBusy(false) }
  }
  return <Section title="同创意 · 视频版本" desc="当前分镜作为基础脚本。锁定创意与叙事结构，只在选定范围内变化；每个版本最终生成一条完整视频。" right={<Badge tone="brand">{existing} 个版本</Badge>}>
    <div className="version-plan-fixed"><strong>所有版本保持一致</strong><p>核心创意、镜头顺序与时长、产品卖点与事实、品牌素材、结尾 CTA</p>{plan && <p>开头钩子：{plan.hookStrategy}</p>}{plan?.fixedNotes && <p>{plan.fixedNotes}</p>}</div>
    {!plan && <Field label="共用的开头钩子" hint="描述开头机制，例如：前三秒均用人物动作展示出行痛点"><textarea className="input" rows={2} value={hook} onChange={e => setHook(e.target.value)} /></Field>}
    <fieldset className="version-choices" disabled={!!plan}><legend>允许变化的内容</legend>{Object.entries(versionChanges).map(([key, label]) => <label key={key}><input type="checkbox" checked={allowed.includes(key)} onChange={e => setAllowed(e.target.checked ? [...allowed, key] : allowed.filter(v => v !== key))} />{label}</label>)}</fieldset>
    {!plan && <Field label="其他固定要求（可选）"><input className="input" value={notes} placeholder="例如：始终采用人物痛点展示 → 产品解决 → 引导下单" onChange={e => setNotes(e.target.value)} /></Field>}
    <div className="batch-toolbar mt-4"><Field label="视频版本总数（包含基础版本）"><input aria-label="视频版本总数" type="number" min={Math.max(2, existing)} max={60} className="input w-28" value={count} onChange={e => setCount(Number(e.target.value))} /></Field><button className="btn-primary" disabled={busy || !allowed.length || !hook.trim() || !!plan && count <= existing || project.batch?.job?.status === 'running'} onClick={() => void create()}>{busy && <Spinner />}{plan ? `追加 ${Math.max(0, count - existing)} 个版本` : `建立 ${count} 个视频版本`}</button></div>
    <details className="business-disclosure"><summary>指定新增版本的变化要求（可选）</summary><textarea className="input mt-3" rows={3} value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="每行对应一个新增版本，仅在允许范围内变化，例如：人物提袋赶路；人物看表等车。留空由 Agent 设计。" /></details>
    {existing > 1 && <div className="version-plan-next"><p>在上方“版本脚本”中批量准备脚本，完成自动审核后进入视频制作。多个版本的自然差异不能直接作为单变量实验。</p><button className="btn-ghost" onClick={() => goto(6)}>查看视频制作队列 →</button></div>}
  </Section>
}
