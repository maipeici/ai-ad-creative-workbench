import { useEffect, useState } from 'react'
import type { PhaseProps } from '../App'
import { api } from '../api'
import type { GlobalContext, Shot, ValidateResult } from '../types'
import { DetailsWhen, Badge, EmptyHint, Field, IssueRow, Section, Spinner } from '../ui'
import ShotCard from '../components/ShotCard'
import ReferenceGuidance from '../components/ReferenceGuidance'

export default function Phase4Storyboard({ project, meta, patch, setProject, notify, gotoFoundation, preview }: PhaseProps) {
  const [loading, setLoading] = useState(false)
  const [shotCount, setShotCount] = useState<number | ''>('')
  const [shotDuration, setShotDuration] = useState<number | ''>('')
  const [pref, setPref] = useState('')
  const [previewAll, setPreviewAll] = useState(false)
  const [validation, setValidation] = useState<ValidateResult | null>(null)
  const sb = project.storyboard
  const concept = project.concepts?.find((c) => c.id === project.selectedConceptId)
  const selectedAssetIds = Object.values(project.assets || {}).flat()
  const selectedFactIds = project.facts || []
  const total = sb?.shots.reduce((a, s) => a + (Number(s.durationSec) || 0), 0) || 0
  const target = concept?.durationSec || project.brief.durationSec

  const revalidate = async () => {
    if (!sb || preview) return
    try {
      setValidation(await api.validate(project.id))
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    revalidate()
  }, [project.updatedAt])

  const generate = async () => {
    if (!concept) return notify('请先在广告创意中选定方案', 'error')
    setLoading(true)
    try {
      const { project: p, source, error } = await api.genStoryboard(project.id, {
        shotCount: shotCount || undefined,
        shotDurationSec: shotDuration || undefined,
        userPreference: pref,
      })
      setProject(p)
      notify(error ? `已生成（${source}）：${error}` : `分镜已生成（来源：${source}）`, error ? 'error' : 'ok')
    } catch (e: any) {
      notify(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const updateShot = (id: string, p: Partial<Shot>) => {
    if (!sb) return
    patch({ storyboard: { ...sb, shots: sb.shots.map((s) => (s.id === id ? { ...s, ...p } : s)) } })
  }

  const regenShot = async (id: string, instruction: string) => {
    try {
      const { project: p } = await api.regenShot(project.id, id, instruction)
      setProject(p)
      notify('镜头已重新生成')
    } catch (e: any) {
      notify(e.message, 'error')
    }
  }

  const previewShot = async (id: string) => {
    try {
      const { project: p } = await api.previewShot(project.id, id)
      setProject(p)
    } catch (e: any) {
      notify(e.message, 'error')
    }
  }

  const generateAllPreviews = async () => {
    if (!sb) return
    setPreviewAll(true)
    try {
      for (const s of sb.shots) {
        const { project: p } = await api.previewShot(project.id, s.id)
        setProject(p)
      }
      notify('全部预览图已生成')
    } catch (e: any) {
      notify(e.message, 'error')
    } finally {
      setPreviewAll(false)
    }
  }

  const issuesOf = (shotId: string) => validation?.shots.find((s) => s.shotId === shotId)?.issues || []

  const generationControls = (!project.experimentLink && <DetailsWhen when={!!sb} label="重新生成分镜（可选）"><Section
        title="分镜规划 Agent"
        desc="AI 先产出全局分镜上下文（人物 / 车辆 / 场景 / 视觉锁定描述），再基于它拆分连续镜头，并自动标注哪些镜头需要后期叠加。"
        right={concept ? <Badge tone="brand">{concept.title}</Badge> : <Badge tone="red">未选创意</Badge>}
      >
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_auto_auto] gap-3 items-end">
          <Field label="分镜补充要求（可选）">
            <input
              className="input"
              placeholder="例如：第一镜用特写、产品镜头留足 4 秒"
              value={pref}
              onChange={(e) => setPref(e.target.value)}
            />
          </Field>
          <Field label="镜头数" hint="留空=AI 决定">
            <input
              type="number"
              min={2}
              max={10}
              className="input w-24"
              value={shotCount}
              onChange={(e) => setShotCount(e.target.value ? Number(e.target.value) : '')}
            />
          </Field>
          <Field label="单镜时长" hint="秒 · 可选">
            <input
              type="number"
              min={1}
              max={10}
              step={0.5}
              className="input w-24"
              value={shotDuration}
              onChange={(e) => setShotDuration(e.target.value ? Number(e.target.value) : '')}
            />
          </Field>
          <button className="btn-primary" onClick={generate} disabled={loading || !concept}>
            {loading && <Spinner />}
            {sb ? '重新生成全部' : '生成分镜'}
          </button>
        </div>
        {sb && (
          <p className="mt-3 text-[11px] text-slate-600">
            ⚠ 重新生成全部分镜会清空人工修改、审核状态、已生成视频与测试变体。只想改某一镜请用卡片上的「重生成」。
          </p>
        )}
      </Section></DetailsWhen>)

  return (
    <>
      <ReferenceGuidance reference={concept?.inspiration} stage="storyboard"/>
      {sb?.conceptId&&sb.conceptId!==concept?.id&&<p className="inspiration-notice" role="status">当前已选新的创意方案。下方仍是原方案的分镜与素材，请点击“重新生成全部”后继续制作。</p>}
      {!sb && generationControls}

      {!sb ? (
        <EmptyHint>还没有分镜。选定创意后点击「生成分镜」。</EmptyHint>
      ) : (
        <>


          {validation && (validation.global.length > 0 || validation.missingAssets.length > 0) && (
            <DetailsWhen when={!validation.global.some(issue => issue.severity === 'block') && !validation.missingAssets.length} label={`共用资料提醒 · ${validation.global.length} 项`}><Section
              title="共用资料待处理"
              desc="这些资料会影响分镜；集中检查与自动修复在下一步完成。"
              right={<button className="text-link" onClick={() => gotoFoundation?.(validation.missingAssets.length ? 'assets' : 'brand')}>调整品牌资料 →</button>}
            >
              <div className="space-y-1.5">
                {validation.global.map((g, i) => (
                  <IssueRow
                    key={i}
                    severity={g.severity}
                    reason={g.reason}
                    fix={g.fix}
                  />
                ))}
                {validation.missingAssets.map((a) => (
                  <IssueRow
                    key={a.id}
                    severity="block"
                    reason={`官方素材未上传：${a.name}`}
                    fix={{ action: 'upload', label: a.note || '去品牌素材上传真实素材（App 界面与 Logo 禁止 AI 生成）', auto: false }}
                  />
                ))}
              </div>
            </Section></DetailsWhen>
          )}

          <Section
            title={`分镜卡片（${sb.shots.length} 镜 · 合计 ${total.toFixed(1)}s）`}
            desc="每张卡片可单独编辑与重新生成。涉及优惠、界面、Logo、CTA 的镜头会被强制要求后期叠加。"
            right={
              <div className="flex items-center gap-2 flex-wrap">
                <Badge tone={Math.abs(total - target) <= 1.5 ? 'green' : 'amber'}>
                  目标 {target}s / 实际 {total.toFixed(1)}s
                </Badge>
                {validation && (
                  <>
                    <Badge tone={validation.summary.blockers ? 'red' : 'green'}>阻断 {validation.summary.blockers}</Badge>
                    <Badge tone={validation.summary.warnings ? 'amber' : 'slate'}>提醒 {validation.summary.warnings}</Badge>
                  </>
                )}
                <button className="btn-ghost !py-1 !text-xs" onClick={generateAllPreviews} disabled={previewAll || !!project.experimentLink}>
                  {previewAll && <Spinner />} 生成全部预览图
                </button>
                <button className="btn-ghost !py-1 !text-xs" disabled={!!project.experimentLink} onClick={async () => setProject(await api.addShot(project.id, sb.shots.length))}>
                  + 补镜头
                </button>
              </div>
            }
          >
            <p className="text-[11px] text-amber-400/90 mb-3">
              建议先「生成全部预览图」再进入下一阶段：首帧图会作为视频生成的起始帧，是人物与车辆一致性最有效的手段。
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
              {sb.shots.map((shot) => (
                <ShotCard
                  key={shot.id}
                  readOnly={!!project.experimentLink && !project.experimentLink.editableShotIds.includes(shot.id)}
                  contentOnly={!!project.experimentLink}
                  shot={shot}
                  meta={meta}
                  selectedAssetIds={selectedAssetIds}
                  selectedFactIds={selectedFactIds}
                  issues={issuesOf(shot.id)}
                  onChange={(p) => updateShot(shot.id, p)}
                  onRegen={(ins) => regenShot(shot.id, ins)}
                  onPreview={() => previewShot(shot.id)}
                  onDelete={async () => {
                    if (!confirm(`删除镜头 #${shot.index}？`)) return
                    setProject(await api.removeShot(project.id, shot.id))
                  }}
                />
              ))}
            </div>

          </Section>
          <details className="business-disclosure"><summary>高级设置 · 人物、画面与镜头一致性</summary><Section
            title="全局分镜上下文"
            desc="每个镜头与每次生成都会引用这段锁定描述。修改这里会影响全部镜头的一致性，系统会提示受影响范围。"
            right={<Badge tone={sb.source === 'gemini' || sb.source === 'llm' ? 'green' : 'amber'}>{sb.source}</Badge>}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(
                [
                  ['coreIdea', '核心创意'],
                  ['conversionGoal', '转化目标'],
                  ['audienceScene', '人群与场景'],
                  ['sellingPoint', '卖点与事实依据'],
                  ['person', '人物锁定（英文）'],
                  ['vehicle', '车辆锁定（英文）'],
                  ['scene', '场景锁定（英文）'],
                  ['timeWeather', '时间与天气'],
                  ['visualStyle', '视觉风格'],
                  ['lighting', '光照'],
                  ['cameraStyle', '镜头风格'],
                  ['subtitleStyle', '字幕与口播风格'],
                  ['productUIVersion', '产品界面版本'],
                ] as [keyof GlobalContext, string][]
              ).map(([key, label]) => (
                <Field key={key} label={label}>
                  <textarea
                    disabled={!!project.experimentLink}
                    className="input h-14 resize-none !text-[11px] leading-relaxed"
                    value={sb.globalContext?.[key] || ''}
                    onChange={(e) =>
                      setProject({
                        ...project,
                        storyboard: { ...sb, globalContext: { ...sb.globalContext, [key]: e.target.value } },
                      })
                    }
                    onBlur={(e) => patch({ storyboard: { ...sb, globalContext: { ...sb.globalContext, [key]: e.target.value } } })}
                  />
                </Field>
              ))}
            </div>
          </Section></details>
          {generationControls}
        </>
      )}
    </>
  )
}
