import { useEffect, useState } from 'react'
import type { PhaseProps } from '../App'
import type { Brief } from '../types'
import { Badge, Field, Section } from '../ui'

export default function Phase2Brief({ project, meta, patch, goto, openReferences, openExperiments, registerBeforeLeave }: PhaseProps) {
  const { brandGuide, channels } = meta
  const [brief, setBrief] = useState<Brief>(project.brief)
  const [dirty, setDirty] = useState(false)

  useEffect(() => setBrief(project.brief), [project.id])

  const set = <K extends keyof Brief>(k: K, v: Brief[K]) => {
    setBrief((b) => ({ ...b, [k]: v }))
    setDirty(true)
  }

  const save = async () => {
    const facts = project.facts.filter(id => id !== project.brief.campaignFactId)
    await patch({ brief, facts: brief.campaignFactId ? [...new Set([...facts, brief.campaignFactId])] : facts, phase: Math.max(project.phase, 2) })
    setDirty(false)
  }
  useEffect(() => { registerBeforeLeave?.(dirty ? save : null); return () => registerBeforeLeave?.(null) }, [brief, dirty, project.id, registerBeforeLeave])

  const channel = channels.find((c) => c.id === brief.channel)
  const audience = brandGuide.audienceOptions.find((a) => a.id === brief.audience)
  const scene = brandGuide.sceneOptions.find((s) => s.id === brief.scene)
  const cta = brandGuide.ctaOptions.find((c) => c.id === brief.cta)

  const selectedFacts = (project.facts || [])
    .map((id) => meta.facts.facts.find((f) => f.id === id))
    .filter(Boolean)
  const today = new Date().toISOString().slice(0, 10)
  const usable = (f: typeof meta.facts.facts[number]) => f.status === 'confirmed' && (!f.validFrom || /^\d{4}-\d{2}-\d{2}$/.test(f.validFrom) && f.validFrom <= today) && (!f.validTo || /^\d{4}-\d{2}-\d{2}$/.test(f.validTo) && f.validTo >= today)
  const confirmedCampaigns = meta.facts.facts.filter(f => usable(f) && f.type === 'campaign' && (f.brandId || 'hxz-ad-v1') === (project.brandGuideId || 'hxz-ad-v1'))

  return (
    <>
      <div className="brand-resource-summary"><strong>{brandGuide.brandIdentity.productName}</strong><span className="text-sm text-slate-400">已选 {project.facts.length} 条事实 · {Object.values(project.assets).flat().length} 项素材</span><button className="btn-ghost ml-auto" onClick={() => goto(1)}>调整本次选用</button></div>
      <Section
        title="本次推广任务"
        desc="明确这批素材「对谁说、在什么场景说、解决什么问题、用哪个有依据的卖点回应、希望用户做什么」。"
        right={dirty ? <Badge tone="amber">未保存</Badge> : <Badge tone="green">已保存</Badge>}
      >
        <div className="brief-fields">
          <div className="brief-column">
            <Field label="投放渠道">
              <div className="flex flex-wrap gap-1.5">
                {channels.map((c) => (
                  <button key={c.id} className={brief.channel === c.id ? 'chip-on' : 'chip-off'} onClick={() => set('channel', c.id)}>
                    {c.name}
                  </button>
                ))}
              </div>
              {channel && (
                <div className="brief-help brief-channel-notes">
                  <p>建议时长 {channel.recommendedDuration.join('–')}s · {channel.resolution}</p>
                  <p className="brief-warning">安全区：{channel.safeArea.note}</p>
                  <p>{channel.firstFrameRule}</p>
                  <p>{channel.audioRule}</p>
                </div>
              )}
            </Field>

            <Field label="目标人群">
              <div className="flex flex-wrap gap-1.5">
                {brandGuide.audienceOptions.map((a) => (
                  <button key={a.id} className={brief.audience === a.id ? 'chip-on' : 'chip-off'} onClick={() => set('audience', a.id)}>
                    {a.name}
                  </button>
                ))}
              </div>
              {audience && (
                <p className="brief-help">
                  典型痛点：{audience.painPoints.join(' · ')}
                </p>
              )}
            </Field>

            <Field label="出行场景">
              <div className="flex flex-wrap gap-1.5">
                {brandGuide.sceneOptions.map((s) => (
                  <button key={s.id} className={brief.scene === s.id ? 'chip-on' : 'chip-off'} onClick={() => set('scene', s.id)}>
                    {s.name}
                  </button>
                ))}
              </div>
              {scene && <p className="brief-help">{scene.prompt}</p>}
            </Field>

            <Field label="选用营销活动" hint="直接关联活动事实，无需重复填写权益">
              <select className="input" value={brief.campaignFactId || ''} onChange={e => { const fact = confirmedCampaigns.find(f => f.id === e.target.value); setBrief(b => ({ ...b, campaignFactId: fact?.id || '', campaign: fact?.title || '' })); setDirty(true) }}><option value="">不使用营销活动，只表达产品功能</option>{confirmedCampaigns.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}</select>
              {!brief.campaignFactId && brief.campaign && <p className="brief-help">旧任务活动描述：{brief.campaign}。可从上方关联真实活动资料。</p>}
              {confirmedCampaigns.length === 0 && (
                <p className="brief-help brief-warning">
                  当前没有有效且已确认的活动。新方案应只表达产品功能；旧方案如有权益表述，请先补充有效依据再制作。
                </p>
              )}
            </Field>
          </div>

          <div className="brief-column">
            <Field label="核心卖点" hint="本条素材主打什么">
              <input
                className="input"
                placeholder="例如：一键叫车，行前可看预估价"
                value={brief.sellingPoint}
                onChange={(e) => set('sellingPoint', e.target.value)}
              />
              {selectedFacts.filter(f => usable(f!)).length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {selectedFacts
                    .filter(f => usable(f!))
                    .map((f) => (
                      <button key={f!.id} className="chip-off !text-[10px]" onClick={() => set('sellingPoint', f!.title)}>
                        {f!.title}
                      </button>
                    ))}
                </div>
              )}
            </Field>

            <Field label="主要转化事件" hint="每个任务选择一个主要目标，便于后续比较效果">
              {!brief.conversionEvent && <p className="brief-help">旧任务目标：{brief.goal || '未填写'}。可从下方明确一个主要事件。</p>}
              <div className="flex flex-wrap gap-1.5">
                {[['download', '下载'], ['first-order', '首单'], ['order', '下单'], ['claim', '领券'], ['awareness', '品牌认知'], ['return', '老客回流']].map(([id, label]) => (
                  <button key={id} className={brief.conversionEvent === id ? 'chip-on' : 'chip-off'} onClick={() => { setBrief(b => ({ ...b, conversionEvent: id, goal: '引导' + label })); setDirty(true) }}>
                    {label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="内容基调">
              <div className="flex flex-wrap gap-1.5">
                {brandGuide.toneOptions.map((t) => (
                  <button key={t.id} className={brief.tone === t.id ? 'chip-on' : 'chip-off'} onClick={() => set('tone', t.id)}>
                    {t.name}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="结尾行动引导 CTA">
              <div className="flex flex-wrap gap-1.5">
                {brandGuide.ctaOptions.map((c) => (
                  <button key={c.id} className={brief.cta === c.id ? 'chip-on' : 'chip-off'} onClick={() => set('cta', c.id)}>
                    {c.name}
                  </button>
                ))}
              </div>
              {cta && <p className="brief-help">文案：「{cta.text}」· 动作类型 {cta.action}</p>}
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field
                label={`目标时长：${brief.durationSec}s`}
                hint={channel ? `${channel.name} 建议 ${channel.recommendedDuration.join('–')}s` : ''}
              >
                <input
                  type="range"
                  min={brandGuide.format.durationRange[0]}
                  max={brandGuide.format.durationRange[1]}
                  step={1}
                  value={brief.durationSec}
                  onChange={(e) => set('durationSec', Number(e.target.value))}
                  className="w-full accent-brand"
                />
              </Field>
              <Field label="参考视频">
                <button className="btn-ghost" onClick={openReferences}>从统一参考库选用 →</button>
                {brief.reference && <p className="brief-help">历史参考备注：{brief.reference}</p>}
              </Field>
            </div>

            <Field label="承接页面 / App 页面" hint="记录广告点击后到达的位置，用于核对承诺与转化路径">
              <input className="input" value={brief.landingUrl || ''} onChange={e => set('landingUrl', e.target.value)} placeholder="落地页地址或 App 内页面名称" />
            </Field>
            <div className="grid grid-cols-2 gap-4"><Field label="计划交付数量"><input type="number" min="1" max="100" className="input" value={brief.deliveryCount || 1} onChange={e => set('deliveryCount', Number(e.target.value))} /></Field><Field label="交付截止日期"><input type="date" className="input" value={brief.dueDate || ''} onChange={e => set('dueDate', e.target.value)} /></Field></div>
            <Field label="制作条件限制（可选）">
              <input
                className="input"
                placeholder="例如：没有真人出镜资源、只能用现有界面截图"
                value={brief.constraints}
                onChange={(e) => set('constraints', e.target.value)}
              />
            </Field>

            <Field label="其它要求（可选）">
              <textarea
                className="input h-16 resize-none"
                placeholder="例如：必须出现雨天场景、结尾要露 Logo"
                value={brief.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </Field>
          </div>
        </div>

        <div className="brief-footer mt-6 pt-4 border-t border-ink-600 flex items-center justify-between gap-4">
          <div className="brief-summary">
            <span className="text-slate-300">本条素材：</span>
            对「{audience?.name || '—'}」在「{scene?.name || '—'}」场景下说，
            用「{brief.sellingPoint || '—'}」回应，引导「{cta?.name || '—'}」
          </div>
          <div className="flex gap-2 shrink-0">
            <button className="btn-ghost" onClick={save} disabled={!dirty}>
              保存
            </button>
            <button
              className="btn-primary"
              onClick={() => goto(3)}
            >
              下一步：生成广告创意 →
            </button>
          </div>
        </div>
      </Section>
      <div className="business-context">需要验证不同素材的效果？先确定创意与基准分镜，再锁定一个变量建立实验。<button className="btn-ghost" onClick={openExperiments}>查看素材测试 →</button></div>
    </>
  )
}
