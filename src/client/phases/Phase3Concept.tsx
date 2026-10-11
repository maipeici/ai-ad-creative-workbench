import InspirationPanel from '../components/InspirationPanel'
import '../styles/inspiration.css'
import { useState } from 'react'
import type { PhaseProps } from '../App'
import { api } from '../api'
import type { Concept } from '../types'
import { Badge, EmptyHint, Field, IssueRow, RoleBadge, Section, Spinner } from '../ui'

export default function Phase3Concept(props: PhaseProps) {
  const { project, meta, patch, setProject, notify, goto } = props
  const [creativeTab, setCreativeTab] = useState<'concepts'|'references'>('concepts')
  const [loading, setLoading] = useState(false)
  const [pref, setPref] = useState('')
  const [count, setCount] = useState(3)
  const [editing, setEditing] = useState<string | null>(null)

  const concepts = project.concepts || []
  const selected = concepts.find((c) => c.id === project.selectedConceptId) || null
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

  const tabs = <div className="inspiration-mode" aria-label="广告创意工作区"><button className={creativeTab==='concepts'?'active':''} onClick={()=>setCreativeTab('concepts')}>创意方案</button><button className={creativeTab==='references'?'active':''} onClick={()=>setCreativeTab('references')}>爆款参考</button></div>
  if (creativeTab === 'references') return <>{tabs}<InspirationPanel {...props} onApplied={()=>setCreativeTab('concepts')} /></>
  return (
    <>
      {tabs}
      <div className="concept-entry"><div><strong>从同行、同平台的热门内容中寻找创意</strong><p>导入视频参考，拆解脚本结构，把可迁移的方法应用到当前品牌。</p></div><button className="btn-ghost" onClick={()=>setCreativeTab('references')}>浏览爆款参考 →</button></div>
      <Section
        title="广告创意生成控制台"
        desc="AI 基于品牌规范、已确认事实、合规词库与投放需求生成多个创意方案。只有已确认的事实会被用于卖点表达。"
        right={<Badge tone={selected ? 'green' : 'amber'}>{selected ? '已选定方案' : '未选定'}</Badge>}
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
            <button className="btn-primary" onClick={() => generate(false)} disabled={loading}>
              {loading && <Spinner />}
              {concepts.length ? '重新生成' : '生成创意方案'}
            </button>
            {concepts.length > 0 && (
              <button className="btn-ghost" onClick={() => generate(true)} disabled={loading}>
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

      {concepts.length === 0 ? (
        <EmptyHint>还没有创意方案，点击上方「生成创意方案」开始。</EmptyHint>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {concepts.map((c) => {
            const on = c.id === project.selectedConceptId
            const isEditing = editing === c.id
            const blockers = (c.complianceHits || []).filter((h) => h.severity === 'block')
            return (
              <div
                key={c.id}
                className={`card p-4 transition-colors ${
                  blockers.length ? 'border-red-800/60' : on ? 'border-brand/60 bg-brand/[0.04]' : 'hover:border-ink-500'
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    aria-label={'选择创意：' + c.title}
                    onClick={() => patch({ selectedConceptId: c.id })}
                    className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 grid place-items-center ${
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
                    <button className="text-[11px] text-slate-500 hover:text-brand" onClick={() => setEditing(isEditing ? null : c.id)}>
                      {isEditing ? '完成' : '微调'}
                    </button>
                  </div>
                </div>

                {c.inspiration && <div className="inspiration-attribution"><strong>{c.inspiration.isDemo?'示例结构复用':'来源于参考视频'} · {c.inspiration.title}</strong><p>复用方法：{c.inspiration.summary}</p>{c.inspiration.sourceUrl && <a className="inspiration-link" href={c.inspiration.sourceUrl} target="_blank" rel="noopener noreferrer">查看原视频 ↗</a>}</div>}
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

                  <div className="grid grid-cols-2 gap-2.5">
                    <Row label="击中痛点">
                      <p className="text-[11px] text-slate-400">{c.painPoint}</p>
                    </Row>
                    <Row label="人群场景匹配">
                      <p className="text-[11px] text-slate-400">{c.audienceFit}</p>
                    </Row>
                  </div>

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

                  <Row label="结尾 CTA">
                    {isEditing ? (
                      <input className="input" value={c.ctaText} onChange={(e) => update(c.id, 'ctaText', e.target.value)} />
                    ) : (
                      <p className="text-xs text-amber-300">{c.ctaText}</p>
                    )}
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

      {selected && (
        <div className="flex justify-end">
          <button className="btn-primary" onClick={() => goto(4)}>
            下一步：生成分镜 →
          </button>
        </div>
      )}
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
