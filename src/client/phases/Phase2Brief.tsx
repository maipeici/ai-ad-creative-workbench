import { useEffect, useState } from 'react'
import type { PhaseProps } from '../App'
import type { Brief } from '../types'
import { Badge, Field, Section } from '../ui'

export default function Phase2Brief({ project, meta, patch, goto }: PhaseProps) {
  const { brandGuide, channels } = meta
  const [brief, setBrief] = useState<Brief>(project.brief)
  const [dirty, setDirty] = useState(false)

  useEffect(() => setBrief(project.brief), [project.id])

  const set = <K extends keyof Brief>(k: K, v: Brief[K]) => {
    setBrief((b) => ({ ...b, [k]: v }))
    setDirty(true)
  }

  const save = async () => {
    await patch({ brief, phase: Math.max(project.phase, 2) })
    setDirty(false)
  }

  const channel = channels.find((c) => c.id === brief.channel)
  const audience = brandGuide.audienceOptions.find((a) => a.id === brief.audience)
  const scene = brandGuide.sceneOptions.find((s) => s.id === brief.scene)
  const cta = brandGuide.ctaOptions.find((c) => c.id === brief.cta)

  const selectedFacts = (project.facts || [])
    .map((id) => meta.facts.facts.find((f) => f.id === id))
    .filter(Boolean)
  const confirmedCampaigns = selectedFacts.filter((f) => f!.status === 'confirmed' && f!.type === 'campaign')

  return (
    <>
      <Section
        title="投放需求 Content Brief"
        desc="明确这条素材「对谁说、在什么场景说、解决什么问题、用哪个有依据的卖点回应、希望用户做什么」。"
        right={dirty ? <Badge tone="amber">未保存</Badge> : <Badge tone="green">已保存</Badge>}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <Field label="投放渠道">
              <div className="flex flex-wrap gap-1.5">
                {channels.map((c) => (
                  <button key={c.id} className={brief.channel === c.id ? 'chip-on' : 'chip-off'} onClick={() => set('channel', c.id)}>
                    {c.name}
                  </button>
                ))}
              </div>
              {channel && (
                <div className="mt-2 text-[10px] text-slate-500 bg-ink-900 border border-ink-600 rounded p-2.5 space-y-1 leading-relaxed">
                  <p>建议时长 {channel.recommendedDuration.join('–')}s · {channel.resolution}</p>
                  <p className="text-amber-400">安全区：{channel.safeArea.note}</p>
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
                <p className="mt-2 text-[10px] text-slate-500">
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
              {scene && <p className="mt-2 text-[10px] text-slate-600">{scene.prompt}</p>}
            </Field>

            <Field label="营销活动" hint="需与 Phase 1 已确认的活动事实对应">
              <input
                className="input"
                placeholder="例如：新人首单活动（对应 fact-campaign-newuser）"
                value={brief.campaign}
                onChange={(e) => set('campaign', e.target.value)}
              />
              {confirmedCampaigns.length === 0 && (
                <p className="mt-1.5 text-[10px] text-amber-400">
                  当前没有已确认的活动事实，创意将只表达产品通用功能，不会出现任何优惠金额。
                </p>
              )}
              {confirmedCampaigns.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {confirmedCampaigns.map((f) => (
                    <button
                      key={f!.id}
                      className="chip-off !text-[10px]"
                      onClick={() => set('campaign', f!.title)}
                    >
                      使用「{f!.title}」
                    </button>
                  ))}
                </div>
              )}
            </Field>
          </div>

          <div className="space-y-4">
            <Field label="核心卖点" hint="本条素材主打什么">
              <input
                className="input"
                placeholder="例如：一键叫车，行前可看预估价"
                value={brief.sellingPoint}
                onChange={(e) => set('sellingPoint', e.target.value)}
              />
              {selectedFacts.filter((f) => f!.status === 'confirmed').length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {selectedFacts
                    .filter((f) => f!.status === 'confirmed')
                    .map((f) => (
                      <button key={f!.id} className="chip-off !text-[10px]" onClick={() => set('sellingPoint', f!.title)}>
                        {f!.title}
                      </button>
                    ))}
                </div>
              )}
            </Field>

            <Field label="转化目标">
              <div className="flex flex-wrap gap-1.5">
                {['引导下载与首单', '引导领券', '引导叫车下单', '提升品牌认知', '老客回流'].map((g) => (
                  <button key={g} className={brief.goal === g ? 'chip-on' : 'chip-off'} onClick={() => set('goal', g)}>
                    {g}
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
              {cta && <p className="mt-2 text-[10px] text-slate-500">文案：「{cta.text}」· 动作类型 {cta.action}</p>}
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
              <Field label="参考广告 / 热点">
                <input
                  className="input"
                  placeholder="例如：GRWM 结构、对比反差"
                  value={brief.reference}
                  onChange={(e) => set('reference', e.target.value)}
                />
              </Field>
            </div>

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

        <div className="mt-6 pt-4 border-t border-ink-600 flex items-center justify-between gap-4">
          <div className="text-[11px] text-slate-500 leading-relaxed">
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
              onClick={async () => {
                if (dirty) await save()
                goto(3)
              }}
            >
              下一步：生成广告创意 →
            </button>
          </div>
        </div>
      </Section>
    </>
  )
}
