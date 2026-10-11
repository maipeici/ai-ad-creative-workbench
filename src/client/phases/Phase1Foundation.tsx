import { BrandSelector, ComplianceSettings } from '../components/BrandSettings'
import { useRef, useState } from 'react'
import type { PhaseProps } from '../App'
import { api } from '../api'
import type { AssetItem, Fact } from '../types'
import { Badge, FactStatus, Field, Modal, Section } from '../ui'

const FOUNDATION_TABS = [
  { id: 'brand', label: '品牌基础信息', desc: '定位 · 识别 · 核心卖点' },
  { id: 'campaign', label: '营销活动', desc: '活动权益 · 条件 · 路径' },
  { id: 'assets', label: '品牌素材资源', desc: '已有素材 · 官方文件' },
  { id: 'visual', label: '视觉设计', desc: '画面风格 · 镜头 · 光照' },
  { id: 'compliance', label: '合规边界说明', desc: '表达边界 · 使用规则' },
]
export default function Phase1Foundation(props: PhaseProps) {
  const { project, meta, patch, reloadMeta, notify, goto, foundationTab, resourceMode, openReferences } = props
  const { brandGuide, compliance } = meta
  const brandId = project.brandGuideId || 'hxz-ad-v1'
  const assets = { ...meta.assets, items: meta.assets.items.filter(a => (a.brandId || 'hxz-ad-v1') === brandId || !['brand', 'productUI', 'overlay'].includes(a.category) && !a.brandId) }
  const factLib = { ...meta.facts, facts: meta.facts.facts.filter(f => (f.brandId || 'hxz-ad-v1') === brandId) }
  const [tab, setTab] = useState(foundationTab || 'brand')
  const visual = meta.visualDesign
  const logoAsset = assets.items.find(item => item.id === 'brand-logo-main') || assets.items.find(item => item.category === 'brand' && item.refImage)
  const factTypes = tab === 'brand' ? ['feature'] : tab === 'campaign' ? ['campaign', 'conversion-path'] : ['compliance-note']
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
      const { asset, warnings } = await api.buildCtaCard(ctaText.trim(), brandId)
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
      await api.createAsset({ ...draft, category: newAssetCat, brandId })
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
        await api.createFact({ ...factDraft, brandId })
        await reloadMeta()
        notify('事实条目已新增')
      }
      setFactDraft(null)
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  const totalAssets = Object.values(selected).reduce((a, v) => a + v.length, 0)
  const visibleSelectedFacts = factLib.facts.filter(f => factTypes.includes(f.type) && selectedFacts.includes(f.id))
  const confirmedCount = visibleSelectedFacts.filter(f => f.status === 'confirmed').length
  const pendingSelected = visibleSelectedFacts.filter(f => f.status !== 'confirmed')
  const missingOfficial = Object.values(selected)
    .flat()
    .map((id) => assets.items.find((i) => i.id === id))
    .filter((a) => a && (a.tags || []).includes('official-required') && !a.refImage)

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={onFileChange} />

      <nav className="foundation-nav" aria-label="基础配置板块">
        {FOUNDATION_TABS.map((item, i) => (
          <button key={item.id} type="button" aria-pressed={tab === item.id}
            className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>
            <span className="foundation-tab-number">{'0' + (i + 1)}</span>
            <strong>{item.label}</strong><small>{item.desc}</small>
          </button>
        ))}
      </nav>
      <div className="foundation-scope">
        <Badge tone="brand">共享资料 · 项目独立选用</Badge>
        <span>{resourceMode ? '这里的勾选会作为新任务的默认资料；已有任务保持原来的选用。' : '在本环节新增或选择品牌、活动与素材；所选内容用于整批视频。'}</span>
        {!resourceMode && <button className="btn-ghost ml-auto" onClick={async () => { try { await api.saveWorkspace({ defaults: { assets: project.assets, facts: project.facts, brandGuideId: project.brandGuideId } }); notify('已设为新任务默认资料') } catch (e: any) { notify(e.message, 'error') } }}>将本次选用设为默认</button>}
      </div>

      {tab === 'brand' && <BrandSelector {...props} />}
      {tab === 'compliance' && <ComplianceSettings {...props} />}
      {tab === 'brand' && <Section title="品牌基础信息" desc="品牌是谁、提供什么价值，以及识别品牌所需的 Logo 和品牌色。">
        <div className="brand-identity-grid">
          <div className="brand-logo-card">
            {logoAsset?.refImage ? <img src={logoAsset.refImage} alt={brandGuide.brandIdentity.productName + ' Logo'} /> : <div className="brand-logo-empty">Logo 待上传</div>}
            <strong>{brandGuide.brandIdentity.productName}</strong>
            <span>{brandGuide.brandIdentity.productNameEn}</span>
            <button className="btn-ghost !text-xs" onClick={() => setTab('assets')}>管理品牌 Logo</button>
          </div>
          <div className="space-y-5">
            <Info label="产品定位" value={brandGuide.brandIdentity.positioning} />
            <Info label="产品品类" value={brandGuide.brandIdentity.category} />
            <div><div className="label">品牌色</div>
              <div className="flex gap-3 flex-wrap">
                {[['主色', brandGuide.brandIdentity.primaryColor], ['辅助色', brandGuide.brandIdentity.secondaryColor]].map(([name, color]) => (
                  <div key={name} className="brand-color"><span style={{ background: color }} /><div>{name}<code>{color}</code></div></div>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 mt-2">{brandGuide.brandIdentity.primaryColorNote}</p>
            </div>
            <Info label="品牌字体" value={brandGuide.brandIdentity.fontFamily} />
          </div>
          <div><div className="label">Logo 使用规范</div><ul className="foundation-rules">
            {brandGuide.brandIdentity.logoRules.map(rule => <li key={rule}>{rule}</li>)}
          </ul></div>
        </div>
        {brandGuide.notice && <p className="foundation-notice">{brandGuide.notice}</p>}
      </Section>}

      {tab === 'visual' && <Section title="视觉设计" desc="供创作使用的视觉、镜头和光照预设。生成分镜时作为默认值，可在分镜全局上下文中调整。">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="foundation-detail"><Info label="视觉风格" value={visual.visualStyle.label} sub={visual.visualStyle.description} /></div>
          <div className="foundation-detail"><Info label="镜头风格" value={visual.cameraStyle.label} sub="景别与运动方式共同决定画面的叙事节奏。" />
            <div className="label mt-4">机位与景别</div><p className="text-xs text-slate-400 leading-relaxed">{visual.cameraStyle.defaultAngles.join(' / ')}</p>
            <div className="label mt-4">镜头运动</div><p className="text-xs text-slate-400 leading-relaxed">{visual.cameraStyle.defaultMovements.join(' / ')}</p>
          </div>
        </div>
        <div className="label mt-6">光照预设</div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {visual.lighting.presets.map(preset => <div className="foundation-detail" key={preset.id}>
            <div className="flex items-center gap-2 mb-2"><strong className="text-xs">{preset.name}</strong>{preset.id === visual.lighting.default && <Badge tone="brand">默认</Badge>}</div>
            <p className="text-[11px] text-slate-400 leading-relaxed">{preset.prompt}</p>
          </div>)}
        </div>
        <div className="foundation-detail mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Info label="画幅与分辨率" value={visual.format.aspectRatio + ' · ' + visual.format.resolution} />
          <Info label="帧率" value={visual.format.fps + ' fps'} />
          <Info label="建议时长" value={visual.format.durationRange.join('–') + ' 秒'} />
        </div>
        <details className="mt-5"><summary className="cursor-pointer text-xs text-slate-400">查看画面质量与风格负向词</summary>
          <p className="foundation-detail mt-3 text-xs text-slate-400 leading-relaxed">{Object.values(visual.negativePromptLibrary || {}).flat().join(', ')}</p>
        </details>
      </Section>}

      {tab === 'compliance' && <Section title="通用表达扫描" desc="词库提供快速风险提示，Agent 再结合上下文、品牌要求与平台规则判断。">
        <div className="label mt-6">自动扫描规则 · {compliance.rules.length} 类</div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {compliance.rules.map(rule => <div className="foundation-detail" key={rule.id}>
            <div className="flex items-center gap-2 mb-2"><Badge tone={rule.severity === 'block' ? 'red' : 'amber'}>{rule.severity === 'block' ? '阻断' : '提醒'}</Badge><strong className="text-xs">{rule.name}</strong></div>
            <p className="text-[11px] text-slate-400 leading-relaxed">{rule.terms.join(' · ')}</p>
            <p className="text-[10px] text-slate-500 mt-2">{rule.basis}</p>
          </div>)}
        </div>
        <p className="foundation-notice">审核不会补造活动权益、承诺或官方素材。缺少依据时，结果会列出需要补充的资料。</p>
      </Section>}

      {['brand', 'campaign', 'compliance'].includes(tab) && <Section
        title={tab === 'brand' ? '核心卖点与产品事实' : tab === 'campaign' ? '营销活动与权益' : '补充合规依据'}
        desc="勾选本次素材可以表达的事实。只有「已确认」状态的条目才能在口播、字幕与叠加中出现；未确认的内容系统会拦截，不会自动补造。"
        right={
          <div className="flex items-center gap-2">
            <Badge tone={confirmedCount ? 'green' : 'red'}>已确认 {confirmedCount}</Badge>
            {pendingSelected.length > 0 && <Badge tone="amber">待补充 {pendingSelected.length}</Badge>}
            <button className="btn-ghost !py-1 !text-xs" onClick={() => setFactDraft({ type: tab === 'brand' ? 'feature' : tab === 'campaign' ? 'campaign' : 'compliance-note', status: 'pending' })}>
              + 新增条目
            </button>
          </div>
        }
      >
        {factLib.notice && (
          <p className="text-[11px] text-amber-300 bg-amber-950/30 border border-amber-800/50 rounded p-2.5 mb-3 leading-relaxed">
            {factLib.notice}
          </p>
        )}

        {tab === 'campaign' && <div className="bg-ink-900 border border-ink-600 rounded p-3 mb-4">
          <div className="flex items-start gap-2">
            <span className="text-brand text-sm shrink-0">⊞</span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-slate-300 font-medium">优惠卡片由系统生成，不从网络获取</p>
              <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                活动金额、门槛和有效期以你提供并确认的资料为准。
                系统使用已配置的品牌色与 Logo 按固定版式生成优惠卡，金额、门槛、有效期全部取自下方「已确认」的事实条目，
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
        </div>}

        <div className="space-y-4">
          {factLib.factTypes.filter(ft => factTypes.includes(ft.id)).map((ft) => {
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
      </Section>}

      {/* 已有素材的归档与选用 */}
      {tab === 'assets' && <Section
        title="品牌素材资源库"
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
          {assets.categories.filter(cat => cat.id !== 'reference').map((cat) => {
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
          {!resourceMode && <button className="btn-primary" onClick={() => goto(2)}>
            下一步：填写投放需求 →
          </button>}
        </div>
      </Section>}

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
      <Modal open={!!factDraft} title={factDraft?.id ? '编辑资料条目' : '新增资料条目'} onClose={() => setFactDraft(null)} wide>
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
            {factDraft.type === 'campaign' && <div className="grid grid-cols-2 gap-3">
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
            </div>}
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
