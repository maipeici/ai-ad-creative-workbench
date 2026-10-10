import { useRef, useState } from 'react'
import type { PhaseProps } from '../App'
import { api } from '../api'
import type { AssetItem, Fact } from '../types'
import { Badge, CopyButton, FactStatus, Field, Modal, Section } from '../ui'

export default function Phase1Foundation({ project, meta, patch, reloadMeta, notify, goto }: PhaseProps) {
  const { brandGuide, assets, facts: factLib, compliance } = meta
  const [newAssetCat, setNewAssetCat] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<AssetItem>>({})
  const [factDraft, setFactDraft] = useState<Partial<Fact> | null>(null)
  const [uploadingFor, setUploadingFor] = useState<string | null>(null)
  const [cardBusy, setCardBusy] = useState<string | null>(null)
  const [ctaText, setCtaText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const pendingUploadAsset = useRef<string | null>(null)

  const makeCoupon = async (f: Fact) => {
    setCardBusy(f.id)
    try {
      const { asset } = await api.buildCouponCard(f.id)
      await reloadMeta()
      notify(`优惠卡已生成：${asset.nameCn}（金额来自 ${f.id}）`)
    } catch (err: any) {
      notify(err.message, 'error')
    } finally {
      setCardBusy(null)
    }
  }

  const makeCta = async () => {
    if (!ctaText.trim()) return notify('请输入 CTA 文案', 'error')
    setCardBusy('cta')
    try {
      const { asset, warnings } = await api.buildCtaCard(ctaText.trim())
      await reloadMeta()
      setCtaText('')
      notify(warnings?.length ? `CTA 卡已生成，但有 ${warnings.length} 项提醒` : `CTA 卡已生成：${asset.nameCn}`)
    } catch (err: any) {
      notify(err.message, 'error')
    } finally {
      setCardBusy(null)
    }
  }

  const selected = project.assets || {}
  const selectedFacts = project.facts || []

  const toggleAsset = async (cat: string, id: string) => {
    const cur = selected[cat] || []
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    await patch({ assets: { ...selected, [cat]: next } })
  }

  const toggleFact = async (id: string) => {
    const next = selectedFacts.includes(id) ? selectedFacts.filter((x) => x !== id) : [...selectedFacts, id]
    await patch({ facts: next })
  }

  const onPickFile = (assetId: string) => {
    pendingUploadAsset.current = assetId
    fileRef.current?.click()
  }

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const assetId = pendingUploadAsset.current
    e.target.value = ''
    if (!file || !assetId) return
    setUploadingFor(assetId)
    try {
      const { url } = await api.upload(file)
      await api.updateAsset(assetId, { refImage: url })
      await reloadMeta()
      notify('参考素材已上传')
    } catch (err: any) {
      notify(err.message, 'error')
    } finally {
      setUploadingFor(null)
    }
  }

  const createAsset = async () => {
    if (!newAssetCat || !draft.name) return notify('请填写素材名称', 'error')
    try {
      await api.createAsset({ ...draft, category: newAssetCat })
      await reloadMeta()
      setNewAssetCat(null)
      setDraft({})
      notify('素材已加入资源库')
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  const saveFact = async () => {
    if (!factDraft?.title) return notify('请填写事实标题', 'error')
    try {
      if (factDraft.id) {
        const { impacted } = await api.updateFact(factDraft.id, factDraft)
        await reloadMeta()
        if (impacted?.length) {
          const total = impacted.reduce((a: number, x: any) => a + x.shots.length, 0)
          notify(`事实已更新，有 ${total} 个镜头引用了它，请复核`, 'error')
        } else {
          notify('事实已更新')
        }
      } else {
        await api.createFact(factDraft)
        await reloadMeta()
        notify('事实条目已新增')
      }
      setFactDraft(null)
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  const totalAssets = Object.values(selected).reduce((a, v) => a + v.length, 0)
  const confirmedCount = selectedFacts.filter((id) => factLib.facts.find((f) => f.id === id)?.status === 'confirmed').length
  const pendingSelected = selectedFacts.filter((id) => factLib.facts.find((f) => f.id === id)?.status !== 'confirmed')
  const missingOfficial = Object.values(selected)
    .flat()
    .map((id) => assets.items.find((i) => i.id === id))
    .filter((a) => a && (a.tags || []).includes('official-required') && !a.refImage)

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={onFileChange} />

      {/* ---------------- a. 品牌规范 ---------------- */}
      <Section
        title="a. 花小猪品牌规范（固定知识 · 全局生效）"
        desc="所有阶段的 Prompt 与文案都会自动注入以下规范。修改请编辑 data/brand-guide.json。"
        right={<Badge tone="brand">{brandGuide.id}</Badge>}
      >
        {brandGuide.notice && (
          <p className="text-[11px] text-amber-300 bg-amber-950/30 border border-amber-800/50 rounded p-2.5 mb-4 leading-relaxed">
            {brandGuide.notice}
          </p>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="space-y-3">
            <Info label="产品与定位" value={`${brandGuide.brandIdentity.productName} · ${brandGuide.brandIdentity.positioning}`} />
            <Info label="画幅" value={`${brandGuide.format.aspectRatio} · ${brandGuide.format.resolution} · ${brandGuide.format.fps}fps`} />
            <Info label="时长区间" value={`${brandGuide.format.durationRange.join('–')} 秒`} />
            <div>
              <div className="label">品牌色</div>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded border border-ink-500" style={{ background: brandGuide.brandIdentity.primaryColor }} />
                <code className="text-[11px] text-slate-300">{brandGuide.brandIdentity.primaryColor}</code>
              </div>
              {brandGuide.brandIdentity.primaryColorNote && (
                <p className="text-[10px] text-amber-400 mt-1">{brandGuide.brandIdentity.primaryColorNote}</p>
              )}
            </div>
          </div>
          <div className="space-y-3">
            <Info label="视觉风格" value={brandGuide.visualStyle.label} sub={brandGuide.visualStyle.description} />
            <Info label="镜头风格" value={brandGuide.cameraStyle.label} sub={brandGuide.cameraStyle.defaultAngles.slice(0, 4).join(' / ')} />
            <Info label="光照预设" value={brandGuide.lighting.presets.map((p) => p.name).join(' / ')} />
          </div>
          <div className="space-y-3">
            <div>
              <div className="label">产品展示规则</div>
              <ul className="space-y-1">
                {brandGuide.productDisplayRules.slice(0, 3).map((r) => (
                  <li key={r} className="text-[11px] text-slate-400 flex gap-1.5">
                    <span className="text-brand shrink-0">!</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="label">硬性限制（部分）</div>
              <ul className="space-y-1">
                {brandGuide.restrictions.slice(0, 4).map((r) => (
                  <li key={r} className="text-[11px] text-slate-400 flex gap-1.5">
                    <span className="text-red-500 shrink-0">✕</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-300 select-none">
            查看广告法合规词库（{compliance.rules.length} 类，自动扫描口播/字幕/CTA）
          </summary>
          <div className="mt-2 space-y-2">
            {compliance.rules.map((r) => (
              <div key={r.id} className="bg-ink-900 border border-ink-600 rounded p-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <Badge tone={r.severity === 'block' ? 'red' : 'amber'}>{r.severity === 'block' ? '阻断' : '提醒'}</Badge>
                  <span className="text-[11px] font-medium text-slate-300">{r.name}</span>
                  <span className="text-[10px] text-slate-600">{r.basis}</span>
                </div>
                <p className="text-[10px] text-slate-500 leading-relaxed">{r.terms.join(' · ')}</p>
              </div>
            ))}
          </div>
        </details>

        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-300 select-none">
            查看全局负向 Prompt 库（自动附加到每个镜头）
          </summary>
          <div className="mt-2 flex items-start gap-2">
            <p className="flex-1 text-[11px] text-slate-500 font-mono leading-relaxed bg-ink-900 border border-ink-600 rounded p-3">
              {Object.values(brandGuide.negativePromptLibrary).flat().join(', ')}
            </p>
            <CopyButton text={Object.values(brandGuide.negativePromptLibrary).flat().join(', ')} />
          </div>
        </details>
      </Section>

      {/* ---------------- c. 产品事实与活动资料 ---------------- */}
      <Section
        title="c. 产品事实与活动资料（广告表达的唯一依据）"
        desc="勾选本次素材可以表达的事实。只有「已确认」状态的条目才能在口播、字幕与叠加中出现；未确认的内容系统会拦截，不会自动补造。"
        right={
          <div className="flex items-center gap-2">
            <Badge tone={confirmedCount ? 'green' : 'red'}>已确认 {confirmedCount}</Badge>
            {pendingSelected.length > 0 && <Badge tone="amber">待补充 {pendingSelected.length}</Badge>}
            <button className="btn-ghost !py-1 !text-xs" onClick={() => setFactDraft({ type: 'campaign', status: 'pending' })}>
              + 新增事实
            </button>
          </div>
        }
      >
        {factLib.notice && (
          <p className="text-[11px] text-amber-300 bg-amber-950/30 border border-amber-800/50 rounded p-2.5 mb-3 leading-relaxed">
            {factLib.notice}
          </p>
        )}

        <div className="bg-ink-900 border border-ink-600 rounded p-3 mb-4">
          <div className="flex items-start gap-2">
            <span className="text-brand text-sm shrink-0">⊞</span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-slate-300 font-medium">优惠卡片由系统生成，不从网络获取</p>
              <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                网络上的花小猪优惠信息多来自第三方导流站，金额互相矛盾且常已过期，直接用于投放会构成虚假宣传。
                本系统用官方品牌色与 Logo 按固定版式生成优惠卡，金额、门槛、有效期全部取自下方「已确认」的事实条目，
                确认后点击事实卡片上的「生成优惠卡素材」即可产出可叠加的 PNG。
              </p>
              <div className="flex items-end gap-2 mt-2.5">
                <div className="flex-1">
                  <div className="text-[10px] text-slate-500 mb-1">生成 CTA 按钮素材（会过合规扫描）</div>
                  <input
                    className="input !py-1 !text-[11px]"
                    placeholder="例如：点击下载，立即叫车"
                    value={ctaText}
                    onChange={(e) => setCtaText(e.target.value)}
                  />
                </div>
                <button className="btn-ghost !py-1 !text-[11px]" onClick={makeCta} disabled={cardBusy === 'cta'}>
                  {cardBusy === 'cta' ? '生成中…' : '生成 CTA 卡'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {factLib.factTypes.map((ft) => {
            const items = factLib.facts.filter((f) => f.type === ft.id)
            if (!items.length) return null
            return (
              <div key={ft.id}>
                <h4 className="text-xs font-semibold text-slate-300 mb-2">{ft.name}</h4>
                <div className="space-y-2">
                  {items.map((f) => {
                    const on = selectedFacts.includes(f.id)
                    const usable = f.status === 'confirmed'
                    return (
                      <div
                        key={f.id}
                        className={`rounded-lg border p-3 transition-colors ${
                          on ? (usable ? 'bg-emerald-950/20 border-emerald-800/60' : 'bg-amber-950/20 border-amber-800/60') : 'bg-ink-900 border-ink-600'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <button
                            onClick={() => toggleFact(f.id)}
                            className={`mt-0.5 w-4 h-4 rounded shrink-0 grid place-items-center text-[10px] font-bold ${
                              on ? 'bg-brand text-white' : 'bg-ink-600 text-transparent'
                            }`}
                          >
                            ✓
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-medium text-slate-200">{f.title}</span>
                              <FactStatus status={f.status} />
                              <code className="text-[10px] text-slate-600">{f.id}</code>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{f.statement}</p>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                              {f.couponAmount && <Mini label="金额" value={f.couponAmount} />}
                              {f.threshold && <Mini label="门槛" value={f.threshold} />}
                              {(f.validFrom || f.validTo) && <Mini label="有效期" value={`${f.validFrom || '?'} ~ ${f.validTo || '?'}`} />}
                              {f.cities && <Mini label="城市" value={f.cities} />}
                            </div>
                            {f.source && <p className="text-[10px] text-slate-600 mt-1.5">依据来源：{f.source}</p>}
                            {(f.conditions || []).length > 0 && (
                              <p className="text-[10px] text-slate-500 mt-1">条件：{f.conditions!.join('；')}</p>
                            )}
                            {f.usageNote && <p className="text-[10px] text-brand-soft mt-1">使用要求：{f.usageNote}</p>}

                            {f.type === 'campaign' && (
                              <div className="mt-2 flex items-center gap-2">
                                <button
                                  className="btn-ghost !py-1 !text-[10px]"
                                  disabled={f.status !== 'confirmed' || cardBusy === f.id}
                                  title={f.status !== 'confirmed' ? '事实未确认，无法生成优惠卡' : '用真实金额生成标准优惠卡素材'}
                                  onClick={() => makeCoupon(f)}
                                >
                                  {cardBusy === f.id ? '生成中…' : '⊞ 生成优惠卡素材'}
                                </button>
                                {f.status !== 'confirmed' && (
                                  <span className="text-[10px] text-amber-400">需先补齐并确认后才能生成</span>
                                )}
                              </div>
                            )}
                          </div>
                          <button className="text-[11px] text-slate-500 hover:text-brand shrink-0" onClick={() => setFactDraft(f)}>
                            编辑
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </Section>

      {/* ---------------- b. 素材资源库 ---------------- */}
      <Section
        title="b. 花小猪素材资源库"
        desc="勾选本次素材使用的人物、车辆、场景与产品资产。被选中的素材会以固定措辞锁进每个镜头，这是一致性的关键。标记「官方素材」的项必须上传真实文件。"
        right={<Badge tone={totalAssets ? 'green' : 'red'}>已选 {totalAssets} 项</Badge>}
      >
        {missingOfficial.length > 0 && (
          <p className="text-[11px] text-red-300 bg-red-950/30 border border-red-800/50 rounded p-2.5 mb-4 leading-relaxed">
            以下官方素材尚未上传，引用它们的镜头将被阻断：
            {missingOfficial.map((a) => a!.nameCn || a!.name).join('、')}。App 界面与 Logo 禁止 AI 生成。
          </p>
        )}

        <div className="space-y-5">
          {assets.categories.map((cat) => {
            const items = assets.items.filter((i) => i.category === cat.id)
            const sel = selected[cat.id] || []
            return (
              <div key={cat.id}>
                <div className="flex items-center gap-2 mb-2">
                  <h4 className="text-xs font-semibold text-slate-300">{cat.name}</h4>
                  {!cat.aiGeneratable && <Badge tone="red">必须官方素材</Badge>}
                  <span className="text-[10px] text-slate-600">已选 {sel.length}</span>
                  <button
                    className="ml-auto text-[11px] text-brand hover:text-brand-soft"
                    onClick={() => {
                      setNewAssetCat(cat.id)
                      setDraft({})
                    }}
                  >
                    + 添加素材
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
                  {items.map((item) => {
                    const on = sel.includes(item.id)
                    const needOfficial = (item.tags || []).includes('official-required')
                    const ready = !needOfficial || Boolean(item.refImage)
                    return (
                      <div
                        key={item.id}
                        onClick={() => toggleAsset(cat.id, item.id)}
                        className={`relative rounded-lg border p-2.5 cursor-pointer transition-colors ${
                          on
                            ? ready
                              ? 'bg-brand/10 border-brand/60'
                              : 'bg-red-950/30 border-red-800/60'
                            : 'bg-ink-900 border-ink-600 hover:border-ink-500'
                        }`}
                      >
                        <div className="flex gap-2.5">
                          <div className="w-10 h-14 rounded bg-ink-700 overflow-hidden shrink-0 grid place-items-center">
                            {item.refImage ? (
                              <img src={item.refImage} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span className={`text-[9px] ${needOfficial ? 'text-red-400' : 'text-slate-600'}`}>
                                {needOfficial ? '必传' : '无图'}
                              </span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-slate-200 truncate">{item.nameCn || item.name}</div>
                            <div className="text-[10px] text-slate-600 line-clamp-2 mt-0.5">{item.prompt || item.note}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 mt-2">
                          <button
                            className="text-[10px] text-slate-500 hover:text-brand"
                            onClick={(e) => {
                              e.stopPropagation()
                              onPickFile(item.id)
                            }}
                          >
                            {uploadingFor === item.id ? '上传中…' : item.refImage ? '换素材' : '上传素材'}
                          </button>
                          {item.custom && (
                            <button
                              className="text-[10px] text-slate-600 hover:text-red-400 ml-auto"
                              onClick={async (e) => {
                                e.stopPropagation()
                                await api.deleteAsset(item.id)
                                await reloadMeta()
                              }}
                            >
                              删除
                            </button>
                          )}
                        </div>
                        {on && (
                          <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-brand text-white text-[10px] grid place-items-center font-bold">
                            ✓
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-6 flex items-center justify-between gap-4">
          <p className="text-[11px] text-slate-600">
            {selectedFacts.length === 0 && <span className="text-amber-400">建议先勾选至少一条已确认的产品事实</span>}
          </p>
          <button className="btn-primary" onClick={() => goto(2)} disabled={!totalAssets}>
            下一步：填写投放需求 →
          </button>
        </div>
      </Section>

      {/* 新增素材弹窗 */}
      <Modal open={!!newAssetCat} title="添加素材" onClose={() => setNewAssetCat(null)}>
        <div className="space-y-3">
          <Field label="名称（英文，用于 Prompt）">
            <input className="input" value={draft.name || ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="中文名">
            <input className="input" value={draft.nameCn || ''} onChange={(e) => setDraft({ ...draft, nameCn: e.target.value })} />
          </Field>
          <Field label="Prompt 描述（英文）" hint="会被锁进每个镜头">
            <textarea
              className="input h-20 resize-none"
              value={draft.prompt || ''}
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
            />
          </Field>
          <Field label="专属负向 Prompt（英文，可选）">
            <input className="input" value={draft.negative || ''} onChange={(e) => setDraft({ ...draft, negative: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-ghost" onClick={() => setNewAssetCat(null)}>
              取消
            </button>
            <button className="btn-primary" onClick={createAsset}>
              保存
            </button>
          </div>
        </div>
      </Modal>

      {/* 事实编辑弹窗 */}
      <Modal open={!!factDraft} title={factDraft?.id ? '编辑产品事实' : '新增产品事实'} onClose={() => setFactDraft(null)} wide>
        {factDraft && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Field label="类型">
                <select
                  className="input"
                  value={factDraft.type || 'campaign'}
                  onChange={(e) => setFactDraft({ ...factDraft, type: e.target.value as Fact['type'] })}
                >
                  {factLib.factTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="状态" hint="仅「已确认」可用于素材">
                <select
                  className="input"
                  value={factDraft.status || 'pending'}
                  onChange={(e) => setFactDraft({ ...factDraft, status: e.target.value as Fact['status'] })}
                >
                  {factLib.statusTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="责任人">
                <input className="input" value={factDraft.owner || ''} onChange={(e) => setFactDraft({ ...factDraft, owner: e.target.value })} />
              </Field>
            </div>
            <Field label="标题">
              <input className="input" value={factDraft.title || ''} onChange={(e) => setFactDraft({ ...factDraft, title: e.target.value })} />
            </Field>
            <Field label="事实陈述" hint="广告中可以表达的准确内容">
              <textarea
                className="input h-20 resize-none"
                value={factDraft.statement || ''}
                onChange={(e) => setFactDraft({ ...factDraft, statement: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="优惠金额 / 券面额">
                <input className="input" value={factDraft.couponAmount || ''} onChange={(e) => setFactDraft({ ...factDraft, couponAmount: e.target.value })} />
              </Field>
              <Field label="使用门槛">
                <input className="input" value={factDraft.threshold || ''} onChange={(e) => setFactDraft({ ...factDraft, threshold: e.target.value })} />
              </Field>
              <Field label="有效期起">
                <input className="input" placeholder="2026-09-01" value={factDraft.validFrom || ''} onChange={(e) => setFactDraft({ ...factDraft, validFrom: e.target.value })} />
              </Field>
              <Field label="有效期止">
                <input className="input" placeholder="2026-09-30" value={factDraft.validTo || ''} onChange={(e) => setFactDraft({ ...factDraft, validTo: e.target.value })} />
              </Field>
              <Field label="适用城市">
                <input className="input" value={factDraft.cities || ''} onChange={(e) => setFactDraft({ ...factDraft, cities: e.target.value })} />
              </Field>
              <Field label="领取路径">
                <input className="input" value={factDraft.claimPath || ''} onChange={(e) => setFactDraft({ ...factDraft, claimPath: e.target.value })} />
              </Field>
            </div>
            <Field label="依据来源" hint="活动文档编号 / 运营确认记录，必填才可标为已确认">
              <input className="input" value={factDraft.source || ''} onChange={(e) => setFactDraft({ ...factDraft, source: e.target.value })} />
            </Field>
            <Field label="使用要求">
              <textarea
                className="input h-16 resize-none"
                value={factDraft.usageNote || ''}
                onChange={(e) => setFactDraft({ ...factDraft, usageNote: e.target.value })}
              />
            </Field>
            {factDraft.status === 'confirmed' && !factDraft.source && (
              <p className="text-[11px] text-red-300">标为「已确认」前请填写依据来源，否则无法追溯。</p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              {factDraft.id && (
                <button
                  className="btn-danger mr-auto"
                  onClick={async () => {
                    if (!confirm('删除该事实条目？引用它的镜头会失去依据。')) return
                    await api.deleteFact(factDraft.id!)
                    await reloadMeta()
                    setFactDraft(null)
                  }}
                >
                  删除
                </button>
              )}
              <button className="btn-ghost" onClick={() => setFactDraft(null)}>
                取消
              </button>
              <button className="btn-primary" onClick={saveFact}>
                保存
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}

function Info({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="text-xs text-slate-200">{value}</div>
      {sub && <div className="text-[10px] text-slate-600 mt-0.5 leading-relaxed">{sub}</div>}
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  const pending = String(value).includes('待补充')
  return (
    <div className="bg-ink-800 border border-ink-600 rounded px-2 py-1">
      <div className="text-[9px] text-slate-500">{label}</div>
      <div className={`text-[10px] ${pending ? 'text-amber-400' : 'text-slate-300'}`}>{value}</div>
    </div>
  )
}
