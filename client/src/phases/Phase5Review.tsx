import { useEffect, useState } from 'react'
import type { PhaseProps } from '../App'
import { api } from '../api'
import type { AutoFixResult, Shot, ValidateResult } from '../types'
import { Badge, CopyButton, EmptyHint, IssueRow, RenderModeBadge, RoleBadge, Section, Spinner } from '../ui'
import ShotCard from '../components/ShotCard'

const CHECKLIST = [
  { id: 'audience', label: '创意是否匹配目标人群与出行场景' },
  { id: 'hook', label: '开头钩子是否在 3 秒内清晰呈现' },
  { id: 'selling', label: '产品卖点是否突出且有事实依据' },
  { id: 'facts', label: '优惠金额、门槛、适用条件、活动时间是否准确' },
  { id: 'people', label: '人物、车辆、场景是否合理且一致' },
  { id: 'product', label: '产品展示与下单路径是否符合线上实际' },
  { id: 'brand', label: '是否符合品牌视觉与文案要求' },
  { id: 'framing', label: '镜头是否适合竖屏，主体是否在安全区内' },
  { id: 'copy', label: '口播与字幕能否在目标时长内清楚表达' },
  { id: 'cta', label: 'CTA 是否明确具体' },
  { id: 'compliance', label: '是否通过广告法合规检查（无极限词与绝对化表述）' },
]

export default function Phase5Review({ project, meta, patch, setProject, notify, goto }: PhaseProps) {
  const sb = project.storyboard
  const [pkg, setPkg] = useState<any>(null)
  const [validation, setValidation] = useState<ValidateResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [fixing, setFixing] = useState<string | null>(null)
  const [fixReport, setFixReport] = useState<AutoFixResult | null>(null)
  const selectedAssetIds = Object.values(project.assets || {}).flat()
  const selectedFactIds = project.facts || []

  const load = async () => {
    if (!sb) return
    setLoading(true)
    try {
      const [p, v] = await Promise.all([api.getPackage(project.id), api.validate(project.id)])
      setPkg(p)
      setValidation(v)
    } catch (e: any) {
      notify(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const runFix = async (opts: { shotId?: string; removeMissingAssets?: boolean }) => {
    const key = opts.shotId || (opts.removeMissingAssets ? 'all-remove' : 'all')
    setFixing(key)
    try {
      const res = await api.autofix(project.id, opts)
      setProject(res.project)
      setValidation(res.validation)
      setFixReport(res)
      const fixedBlockers = res.before.blockers - res.after.blockers
      if (res.after.blockers === 0) {
        notify(`修复完成，阻断项已清零（修复 ${res.report.applied.length} 处），可以标记审核通过`)
      } else if (res.report.needsManual.length) {
        notify(
          `已修复 ${res.report.applied.length} 处，还剩 ${res.after.blockers} 项阻断需人工处理（多为官方素材未上传）`,
          'error',
        )
      } else {
        notify(`已修复 ${res.report.applied.length} 处，阻断项减少 ${fixedBlockers}`)
      }
    } catch (e: any) {
      notify(e.message, 'error')
    } finally {
      setFixing(null)
    }
  }

  useEffect(() => {
    load()
  }, [project.updatedAt, project.id])

  if (!sb) return <EmptyHint>还没有分镜可审核，请先完成 Phase 4。</EmptyHint>

  const checklist = project.review?.checklist || {}
  const passedCount = CHECKLIST.filter((c) => checklist[c.id]).length
  const allPassed = passedCount === CHECKLIST.length
  const blockers = validation?.summary.blockers || 0
  const canApprove = allPassed && blockers === 0

  const toggleCheck = (id: string) =>
    patch({ review: { ...project.review, checklist: { ...checklist, [id]: !checklist[id] } } })

  const updateShot = (id: string, p: Partial<Shot>) =>
    patch({ storyboard: { ...sb, shots: sb.shots.map((s) => (s.id === id ? { ...s, ...p } : s)) } })

  const approve = async (approved: boolean) => {
    await patch({
      review: { ...project.review, approved, approvedAt: approved ? new Date().toISOString() : null },
      phase: approved ? Math.max(project.phase, 5) : project.phase,
    })
    notify(approved ? '分镜已通过审核，可进入视频生成' : '已撤销审核')
  }

  const issuesOf = (shotId: string) => validation?.shots.find((s) => s.shotId === shotId)?.issues || []
  const total = sb.shots.reduce((a, s) => a + (Number(s.durationSec) || 0), 0)

  return (
    <>
      <Section
        title="自动校验与修复"
        desc="合规词库、事实绑定、生成方式、官方素材与口播语速的自动检查。每条问题都给出具体改法，可一键修复。阻断项清零后才能通过审核。"
        right={
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone={blockers ? 'red' : 'green'}>阻断 {blockers}</Badge>
            <Badge tone={validation?.summary.warnings ? 'amber' : 'slate'}>提醒 {validation?.summary.warnings || 0}</Badge>
            {!!validation?.summary.autoFixable && (
              <button className="btn-primary !py-1 !text-xs" onClick={() => runFix({})} disabled={fixing !== null}>
                {fixing === 'all' && <Spinner />} 一键修复全部（{validation.summary.autoFixable}）
              </button>
            )}
            <button className="btn-ghost !py-1 !text-xs" onClick={load} disabled={loading}>
              {loading && <Spinner />} 重新检查
            </button>
          </div>
        }
      >
        {!validation ? (
          <EmptyHint>检查中…</EmptyHint>
        ) : blockers === 0 && validation.summary.warnings === 0 ? (
          <div className="text-xs text-emerald-300 bg-emerald-950/30 border border-emerald-800/50 rounded p-3">
            ✓ 未发现问题。合规、事实依据、生成方式、素材就绪与口播语速均通过检查。
          </div>
        ) : (
          <div className="space-y-3">
            {!!validation.summary.needsUpload && (
              <div className="text-[11px] text-slate-300 bg-ink-900 border border-ink-600 rounded p-3 leading-relaxed">
                <p className="font-medium text-brand-soft mb-1">有 {validation.summary.needsUpload} 个镜头引用了未上传的官方素材</p>
                <p className="text-slate-500">
                  App 界面与 Logo 禁止 AI 生成。<span className="text-slate-300">推荐</span>：去 Phase 1 上传真实截图/录屏。
                  若本次先不展示界面，可用下面的「移除未上传素材引用并修复」，系统会移除引用并同步调整文案。
                </p>
                <button
                  className="btn-ghost !py-1 !text-[11px] mt-2"
                  onClick={() => runFix({ removeMissingAssets: true })}
                  disabled={fixing !== null}
                >
                  {fixing === 'all-remove' && <Spinner />} 移除未上传素材引用并修复全部
                </button>
              </div>
            )}

            {validation.global.length > 0 && (
              <div>
                <div className="label">整体问题</div>
                <div className="space-y-1.5">
                  {validation.global.map((g, i) => (
                    <IssueRow
                      key={i}
                      severity={g.severity}
                      reason={g.reason}
                      fix={g.fix}
                      fixing={fixing === 'all'}
                      onFix={g.fix?.auto ? () => runFix({}) : undefined}
                    />
                  ))}
                </div>
              </div>
            )}

            {validation.shots
              .filter((s) => s.issues.length)
              .map((s) => (
                <div key={s.shotId}>
                  <div className="label flex items-center gap-2">
                    镜头 #{s.index} <RoleBadge role={s.role} />
                    {s.issues.some((i) => i.fix?.auto) && (
                      <button
                        className="text-[10px] text-emerald-400 hover:text-emerald-300"
                        onClick={() => runFix({ shotId: s.shotId })}
                        disabled={fixing !== null}
                      >
                        {fixing === s.shotId ? '修复中…' : '修复本镜'}
                      </button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {s.issues.map((iss, i) => (
                      <IssueRow
                        key={i}
                        severity={iss.severity}
                        reason={iss.reason}
                        term={iss.term}
                        fix={iss.fix}
                        fixing={fixing === s.shotId || fixing === 'all'}
                        onFix={
                          iss.fix?.auto
                            ? () => runFix(iss.type === 'asset' ? { shotId: s.shotId, removeMissingAssets: true } : { shotId: s.shotId })
                            : undefined
                        }
                      />
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}

        {fixReport && (
          <div className="mt-4 bg-ink-900 border border-ink-600 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-slate-200">修复报告</span>
              <Badge tone="green">已修 {fixReport.report.applied.length}</Badge>
              {fixReport.report.needsManual.length > 0 && (
                <Badge tone="amber">需人工 {fixReport.report.needsManual.length}</Badge>
              )}
              <span className="text-[10px] text-slate-500">
                阻断 {fixReport.before.blockers} → {fixReport.after.blockers} ｜ 提醒 {fixReport.before.warnings} →{' '}
                {fixReport.after.warnings}
                {fixReport.report.rewriteSource && ` ｜ 文案改写：${fixReport.report.rewriteSource}`}
              </span>
              <button className="ml-auto text-[11px] text-slate-600 hover:text-slate-300" onClick={() => setFixReport(null)}>
                收起
              </button>
            </div>
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {fixReport.report.applied.map((a, i) => (
                <div key={i} className="text-[11px] bg-emerald-950/20 border border-emerald-900/40 rounded px-2.5 py-1.5">
                  <span className="text-emerald-300 font-medium">{a.scope}</span>
                  <span className="text-slate-400 ml-2">{a.detail}</span>
                  {a.before && a.after && (a.before.vo || a.before.subtitle) && (
                    <div className="mt-1 space-y-0.5 text-[10px]">
                      {a.before.vo !== a.after.vo && (
                        <>
                          <p className="text-red-300/70 line-through">口播：{a.before.vo}</p>
                          <p className="text-emerald-300">口播：{a.after.vo || '（已删除）'}</p>
                        </>
                      )}
                      {a.before.subtitle !== a.after.subtitle && (
                        <>
                          <p className="text-red-300/70 line-through">字幕：{a.before.subtitle}</p>
                          <p className="text-emerald-300">字幕：{(a.after.subtitle || '（已删除）').replace(/\n/g, ' / ')}</p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {fixReport.report.needsManual.map((m, i) => (
                <div key={`m${i}`} className="text-[11px] bg-amber-950/20 border border-amber-900/40 rounded px-2.5 py-1.5">
                  <span className="text-amber-300 font-medium">{m.scope}</span>
                  <span className="text-slate-400 ml-2">{m.label || m.reason}</span>
                  {m.action === 'upload-asset' && (
                    <button className="ml-2 text-[10px] text-brand hover:text-brand-soft" onClick={() => goto(1)}>
                      去上传 →
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section
        title="人工审核清单"
        desc="在进入高成本视频生成之前完成检查。全部勾选且无阻断项后才能标记通过。"
        right={
          <Badge tone={project.review?.approved ? 'green' : canApprove ? 'brand' : 'amber'}>
            {project.review?.approved ? '已通过审核' : `${passedCount}/${CHECKLIST.length}`}
          </Badge>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {CHECKLIST.map((c) => (
            <button
              key={c.id}
              onClick={() => toggleCheck(c.id)}
              className={`flex items-start gap-2.5 text-left p-2.5 rounded-lg border transition-colors ${
                checklist[c.id] ? 'bg-emerald-950/30 border-emerald-800/60' : 'bg-ink-900 border-ink-600 hover:border-ink-500'
              }`}
            >
              <span
                className={`mt-0.5 w-4 h-4 rounded shrink-0 grid place-items-center text-[10px] font-bold ${
                  checklist[c.id] ? 'bg-emerald-500 text-white' : 'bg-ink-600 text-transparent'
                }`}
              >
                ✓
              </span>
              <span className={`text-xs ${checklist[c.id] ? 'text-emerald-200' : 'text-slate-300'}`}>{c.label}</span>
            </button>
          ))}
        </div>

        <div className="mt-4">
          <label className="label">审核意见 / 修改记录</label>
          <textarea
            className="input h-20 resize-none"
            placeholder="记录本次审核发现的问题与处理方式"
            defaultValue={project.review?.notes || ''}
            onBlur={(e) => patch({ review: { ...project.review, notes: e.target.value } })}
          />
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[11px] text-slate-600">
            {sb.shots.length} 镜 · {total.toFixed(1)}s · 目标 {project.brief.durationSec}s
            {validation?.channel && ` · ${validation.channel.name}`}
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => goto(4)}>
              ← 返回修改分镜
            </button>
            {project.review?.approved ? (
              <button className="btn-ghost" onClick={() => approve(false)}>
                撤销审核
              </button>
            ) : (
              <>
                {blockers > 0 && !!validation?.summary.autoFixable && (
                  <button className="btn-primary" onClick={() => runFix({})} disabled={fixing !== null}>
                    {fixing === 'all' && <Spinner />} 先一键修复
                  </button>
                )}
                {!allPassed && blockers === 0 && (
                  <button
                    className="btn-ghost"
                    onClick={() =>
                      patch({
                        review: {
                          ...project.review,
                          checklist: Object.fromEntries(CHECKLIST.map((c) => [c.id, true])),
                        },
                      })
                    }
                  >
                    全部勾选清单
                  </button>
                )}
                <button
                  className="btn-primary"
                  onClick={() => approve(true)}
                  disabled={!canApprove}
                  title={
                    blockers > 0
                      ? `还有 ${blockers} 项阻断问题未解决`
                      : !allPassed
                        ? `审核清单还有 ${CHECKLIST.length - passedCount} 项未勾选`
                        : ''
                  }
                >
                  {blockers > 0
                    ? `存在 ${blockers} 项阻断`
                    : !allPassed
                      ? `清单还差 ${CHECKLIST.length - passedCount} 项`
                      : '标记审核通过'}
                </button>
              </>
            )}
            {project.review?.approved && (
              <button className="btn-primary" onClick={() => goto(6)}>
                下一步：生成视频 →
              </button>
            )}
          </div>
        </div>
      </Section>

      <Section
        title="编译后的最终生成指令"
        desc="实际送给视频模型的内容。注意 overlay 类镜头的文字与界面不在 Prompt 里，而是在 Phase 6 精确叠加。"
        right={
          <a className="btn-ghost !py-1 !text-xs" href={`/api/projects/${project.id}/package?download=1`} download>
            导出生产包 JSON
          </a>
        }
      >
        {!pkg ? (
          <EmptyHint>加载中…</EmptyHint>
        ) : (
          <>
            {pkg.factsUsed?.length > 0 && (
              <div className="mb-3 bg-ink-900 border border-ink-600 rounded p-3">
                <div className="label">本素材引用的事实依据</div>
                <div className="space-y-1">
                  {pkg.factsUsed.map((f: any) => (
                    <p key={f.id} className="text-[11px] text-slate-400">
                      <code className="text-emerald-400">{f.id}</code> {f.title} — {f.statement}
                      {f.source && <span className="text-slate-600"> · 来源：{f.source}</span>}
                    </p>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-2">
              {pkg.shots.map((s: any) => (
                <details key={s.id} className="bg-ink-900 border border-ink-600 rounded-lg">
                  <summary className="cursor-pointer px-3 py-2 text-xs text-slate-300 flex items-center gap-2 flex-wrap">
                    <span className="tag bg-brand/15 text-brand-soft">#{s.index}</span>
                    <RoleBadge role={s.role} />
                    <RenderModeBadge mode={s.renderMode} />
                    <span className="truncate flex-1 min-w-0">{s.titleCn}</span>
                    <span className="text-slate-600 text-[10px]">
                      {s.durationSec}s · {s.refImages?.length || 0} 参考图
                    </span>
                  </summary>
                  <div className="px-3 pb-3 space-y-2">
                    {s.vo && <KV label="口播" value={s.vo} />}
                    {s.subtitle && <KV label="字幕（后期烧录）" value={s.subtitle} />}
                    {s.overlayItems?.length > 0 && <KV label="需叠加" value={s.overlayItems.join(' / ')} />}
                    {s.overlayAssets?.length > 0 && (
                      <KV
                        label="叠加素材"
                        value={s.overlayAssets.map((a: any) => `${a.name}${a.ready ? '' : '（未上传）'}`).join(' / ')}
                      />
                    )}
                    {s.factRefs?.length > 0 && <KV label="事实依据" value={s.factRefs.join(', ')} />}
                    <PromptBlock label="PROMPT" text={s.prompt} />
                    <PromptBlock label="NEGATIVE PROMPT" text={s.negativePrompt} dim />
                  </div>
                </details>
              ))}
            </div>
          </>
        )}
      </Section>

      <Section title="分镜复核（可直接修改）" desc="审核中发现问题可在此直接修改，无需回到 Phase 4。">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
          {sb.shots.map((shot) => (
            <ShotCard
              key={shot.id}
              shot={shot}
              meta={meta}
              selectedAssetIds={selectedAssetIds}
              selectedFactIds={selectedFactIds}
              issues={issuesOf(shot.id)}
              onChange={(p) => updateShot(shot.id, p)}
              onPreview={async () => {
                const { project: p } = await api.previewShot(project.id, shot.id)
                setProject(p)
              }}
            />
          ))}
        </div>
      </Section>
    </>
  )
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-[11px] text-slate-400">
      <span className="text-slate-600">{label}：</span>
      {value}
    </p>
  )
}

function PromptBlock({ label, text, dim }: { label: string; text: string; dim?: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold text-slate-500">{label}</span>
        <CopyButton text={text} />
      </div>
      <p
        className={`text-[10px] font-mono leading-relaxed p-2.5 rounded border border-ink-600 ${
          dim ? 'text-slate-600 bg-ink-800/50' : 'text-slate-300 bg-ink-800'
        }`}
      >
        {text}
      </p>
    </div>
  )
}
