import InspirationPanel from '../components/InspirationPanel'
import ReferenceGuidance from '../components/ReferenceGuidance'
import '../styles/inspiration.css'
import { useEffect, useRef, useState } from 'react'
import type { PhaseProps } from '../App'
import { api } from '../api'
import type { Concept } from '../types'
import { Badge, EmptyHint, Field, IssueRow, RoleBadge, Section, Spinner } from '../ui'

export default function Phase3Concept(props: PhaseProps) {
  const { project, meta, patch, setProject, notify, goto } = props
  const [creativeTab, setCreativeTab] = useState<'concepts'|'references'>(props.creativeTab || 'concepts')
  useEffect(() => { if (props.creativeTab) setCreativeTab(props.creativeTab) }, [props.creativeTab])
  const selectTab=(tab:'concepts'|'references')=>{setCreativeTab(tab);props.onCreativeTabChange?.(tab)}
  const [loading, setLoading] = useState(false)
  const [pref, setPref] = useState('')
  const [count, setCount] = useState(3)
  const locked = Boolean(project.versionPlan || (project.batch?.items.length || 0) > 1)
  const [editing, setEditing] = useState<string | null>(null)
  const [appliedId,setAppliedId] = useState('')
  const appliedCard = useRef<HTMLDivElement>(null)
  useEffect(()=>{if(creativeTab==='concepts'&&appliedId)appliedCard.current?.scrollIntoView({block:'start',behavior:'smooth'})},[creativeTab,appliedId])

  const concepts = project.concepts || []
  const factById = new Map(meta.facts.facts.map((f) => [f.id, f]))

  const generate = async (keepExisting: boolean) => {
    setLoading(true)
    try {
      const { project: p, source, error } = await api.genConcepts(project.id, { count, userPreference: pref, keepExisting })
      setProject(p)
      notify(error ? `已生成（${source}）：${error}` : `已生成 ${count} 个创意方案（来源：${source}）`, error ? 'error' : 'ok')
    } catch (e: any) {
      notify(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const update = (id: string, field: keyof Concept, value: any) => {
    patch({ concepts: concepts.map((c) => (c.id === id ? { ...c, [field]: value } : c)) })
  }

  const updateBeat = (id: string, i: number, field: 'name' | 'description' | 'approxSec', value: any) => {
    patch({
      concepts: concepts.map((c) =>
        c.id === id ? { ...c, beats: c.beats.map((b, bi) => (bi === i ? { ...b, [field]: value } : b)) } : c,
      ),
    })
  }

  const audience = meta.brandGuide.audienceOptions.find((a) => a.id === project.brief.audience)
  const scene = meta.brandGuide.sceneOptions.find((s) => s.id === project.brief.scene)

  const analysisCount=Object.keys(project.inspirationAnalyses||{}).length
  const tabs = <div className="creative-workspaces" aria-label="广告创意工作区"><button className={creativeTab==='concepts'?'active':''} aria-label="创意方案" aria-pressed={creativeTab==='concepts'} onClick={()=>selectTab('concepts')}><strong>创意方案</strong><span>确定核心创意，进入分镜与批量制作</span></button><button className={creativeTab==='references'?'active':''} aria-label="爆款参考" aria-pressed={creativeTab==='references'} onClick={()=>selectTab('references')}><strong>爆款参考{analysisCount>0&&<small>已拆解 {analysisCount} 条</small>}</strong><span>上传视频 → 拆解脚本 → 一键导入创意</span></button></div>
  if (creativeTab === 'references') return <>{tabs}<InspirationPanel {...props} onApplied={id=>{setAppliedId(id);selectTab('concepts')}} /></>
  return (
    <>
      {tabs}
      <Section
        title="广告创意 Agent"
        desc="先探索候选方案，再选定一条作为本项目的核心创意。后续多个视频版本共享这条创意与脚本框架。"
      >
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 items-end">
          <Field label="创意指令 / 偏好（可选）">
            <input
              className="input"
              placeholder="例如：钩子要用第一人称、避免过度演绎、突出雨天场景"
              value={pref}
              onChange={(e) => setPref(e.target.value)}
            />
          </Field>
          <div className="flex items-end gap-2">
            <Field label="数量">
              <select className="input w-20" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {[2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <button className="btn-primary" onClick={() => generate(false)} disabled={loading || locked}>
              {loading && <Spinner />}
              {concepts.length ? '重新生成' : '生成创意方案'}
            </button>
            {concepts.length > 0 && (
              <button className="btn-ghost" onClick={() => generate(true)} disabled={loading || locked}>
                追加方案
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 text-[11px] text-slate-600">
          {audience?.name} ｜ {scene?.name} ｜ {project.brief.campaign || '无活动'} ｜ {project.brief.durationSec}s ｜ 已选事实{' '}
          {(project.facts || []).length} 条
        </div>
      </Section>
      {locked && <p className="business-context">本项目已建立多个视频版本，核心创意保持固定。新的创意方向请新建项目，已有分镜和视频会保留。</p>}

      {concepts.length === 0 ? (
        <EmptyHint>还没有创意方案，点击上方「生成创意方案」开始。</EmptyHint>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {concepts.map((c) => {
            const on = project.selectedConceptId === c.id
            const isEditing = editing === c.id
            const blockers = (c.complianceHits || []).filter((h) => h.severity === 'block')
            return (
              <div
                key={c.id}
                ref={c.id===appliedId?appliedCard:undefined}
                className={`card p-4 transition-colors ${
                  blockers.length ? 'border-red-800/60' : on ? 'border-brand/60 bg-brand/[0.04]' : 'hover:border-ink-500'
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    aria-label={'选择创意：' + c.title}
                    aria-pressed={on}
                    disabled={locked}
                    onClick={() => void patch({ selectedConceptId: c.id }).catch(() => {})}
                    className={`mt-0.5 w-4 h-4 rounded border-2 shrink-0 grid place-items-center ${
                      on ? 'border-brand bg-brand' : 'border-ink-500'
                    }`}
                  >
                    {on && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <input className="input text-sm font-semibold" value={c.title} onChange={(e) => update(c.id, 'title', e.target.value)} />
                    ) : (
                      <h4 className="text-sm font-semibold text-slate-100">{c.title}</h4>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge tone="blue">{c.tone}</Badge>
                    <Badge>{c.durationSec}s</Badge>
                    <button disabled={locked} className="text-[11px] text-slate-500 hover:text-brand" onClick={() => setEditing(isEditing ? null : c.id)}>
                      {isEditing ? '完成' : '微调'}
                    </button>
                  </div>
                </div>

                {c.id===appliedId&&<p className="reference-applied" role="status">参考已导入 · 当前方案已选中</p>}
                <ReferenceGuidance reference={c.inspiration}/>
                {blockers.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {blockers.map((h, i) => (
                      <IssueRow key={i} severity="block" reason={`${h.where}命中${h.ruleName}`} term={h.term} />
                    ))}
                  </div>
                )}

                {c.factWarning && (
                  <p className="mt-3 text-[11px] text-amber-300 bg-amber-950/30 border border-amber-800/50 rounded p-2.5 leading-relaxed">
                    {c.factWarning}
                  </p>
                )}

                <div className="mt-3 space-y-2.5">
                  <Row label="核心创意">
                    {isEditing ? (
                      <textarea className="input h-16 resize-none" value={c.coreIdea} onChange={(e) => update(c.id, 'coreIdea', e.target.value)} />
                    ) : (
                      <p className="text-xs text-slate-300">{c.coreIdea}</p>
                    )}
                  </Row>

                  <Row label="前 3 秒钩子">
                    {isEditing ? (
                      <textarea className="input h-16 resize-none" value={c.hook} onChange={(e) => update(c.id, 'hook', e.target.value)} />
                    ) : (
                      <p className="text-xs text-brand-soft">{c.hook}</p>
                    )}
                  </Row>

                  <Row label="核心卖点">
                    {isEditing ? (
                      <input className="input" value={c.sellingPoint} onChange={(e) => update(c.id, 'sellingPoint', e.target.value)} />
                    ) : (
                      <p className="text-xs text-slate-300">{c.sellingPoint}</p>
                    )}
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {(c.factRefs || []).length === 0 ? (
                        <span className="text-[10px] text-amber-400">未绑定事实依据</span>
                      ) : (
                        c.factRefs.map((id) => {
                          const f = factById.get(id)
                          return (
                            <span
                              key={id}
                              className={`tag ${f?.status === 'confirmed' ? 'bg-emerald-900/40 text-emerald-300' : 'bg-red-900/40 text-red-300'}`}
                            >
                              {f ? `${f.title}${f.status !== 'confirmed' ? '（未确认）' : ''}` : id}
                            </span>
                          )
                        })
                      )}
                    </div>
                  </Row>

                  <Row label="结尾 CTA">
                    {isEditing ? (
                      <input className="input" value={c.ctaText} onChange={(e) => update(c.id, 'ctaText', e.target.value)} />
                    ) : (
                      <p className="text-xs text-amber-300">{c.ctaText}</p>
                    )}
                  </Row>

                  <details className="creative-details" open={isEditing || undefined}><summary>查看内容结构与创作依据</summary>
                  <div className="grid grid-cols-2 gap-2.5">
                    <Row label="击中痛点">
                      <p className="text-[11px] text-slate-400">{c.painPoint}</p>
                    </Row>
                    <Row label="人群场景匹配">
                      <p className="text-[11px] text-slate-400">{c.audienceFit}</p>
                    </Row>
                  </div>

                  <Row label="产品出现方式">
                    <p className="text-[11px] text-slate-400">{c.productAppearance}</p>
                  </Row>

                  <Row label="内容结构">
                    <div className="flex flex-wrap gap-1.5">
                      {c.beats?.map((b, i) => (
                        <div key={i} className="flex-1 min-w-[110px] bg-ink-900 border border-ink-600 rounded px-2 py-1.5">
                          <div className="flex items-center gap-1 mb-0.5">
                            <RoleBadge role={b.role} />
                            {b.approxSec ? <span className="text-[9px] text-slate-600">{b.approxSec}s</span> : null}
                          </div>
                          {isEditing ? (
                            <textarea
                              className="bg-transparent text-[10px] text-slate-400 w-full resize-none focus:outline-none"
                              rows={2}
                              value={b.description}
                              onChange={(e) => updateBeat(c.id, i, 'description', e.target.value)}
                            />
                          ) : (
                            <>
                              <div className="text-[10px] font-medium text-slate-300">{b.name}</div>
                              <div className="text-[10px] text-slate-500 leading-snug">{b.description}</div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </Row>

                  {c.whyItWorks && (
                    <div className="text-[11px] text-slate-500 bg-ink-900 border border-ink-600 rounded p-2.5 leading-relaxed">
                      💡 {c.whyItWorks}
                    </div>
                  )}
                  {c.testHypothesis && (
                    <div className="text-[11px] text-sky-300/80 bg-sky-950/20 border border-sky-900/40 rounded p-2.5 leading-relaxed">
                      🧪 可验证假设：{c.testHypothesis}
                    </div>
                  )}

                  </details>

                  {isEditing && (
                    <div className="flex items-center gap-2">
                      <span className="label !mb-0">时长</span>
                      <input
                        type="number"
                        className="input w-20"
                        value={c.durationSec}
                        onChange={(e) => update(c.id, 'durationSec', Number(e.target.value))}
                      />
                      <span className="text-xs text-slate-600">秒</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {concepts.length > 0 && <Section title="本项目的核心创意" desc="下一步先完成基础分镜，再设置视频数量和允许变化项。">
        <div className="batch-toolbar"><strong>{concepts.find(c => c.id === project.selectedConceptId)?.title || '请选择一个方案'}</strong><Badge tone="brand">一条创意 · 多个视频版本</Badge><button className="btn-primary" disabled={loading || !project.selectedConceptId} onClick={() => goto(4)}>确定创意，进入分镜 →</button></div>
      </Section>}
    </>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label !mb-1">{label}</div>
      {children}
    </div>
  )
}
