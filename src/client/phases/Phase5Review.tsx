import { useEffect, useState } from 'react'
import type { PhaseProps } from '../App'
import { api } from '../api'
import type { AutoFixResult, ValidateResult } from '../types'
import { Badge, EmptyHint, IssueRow, RoleBadge, Section, Spinner } from '../ui'
import AutomaticReviewPanel from '../components/AutomaticReviewPanel'

export default function Phase5Review({ project, meta, patch, setProject, notify, goto, gotoFoundation, preview }: PhaseProps) {
  const sb = project.storyboard
  const [validation, setValidation] = useState<ValidateResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [fixing, setFixing] = useState<string | null>(null)
  const [fixReport, setFixReport] = useState<AutoFixResult | null>(project.review?.report ? { report: project.review.report, before: project.review.ruleSummary, after: project.review.ruleSummary } as AutoFixResult : null)

  const load = async () => {
    if (!sb || preview) return
    setLoading(true)
    try {
      const [v, fresh] = await Promise.all([api.validate(project.id), api.getProject(project.id)])
      setProject(fresh)
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
        notify(`修复完成，阻断项已清零（修复 ${res.report.applied.length} 处），请运行自动审核完成清单复检`)
      } else if (res.report.needsManual.length) {
        notify(
          `已修复 ${res.report.applied.length} 处，还剩 ${res.after.blockers} 项阻断需补充资料（多为官方素材未上传）`,
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

  const runReview = async (requirements: string[], autoRepair: boolean) => {
    setFixing('review')
    try {
      const result = await api.automaticReview(project.id, requirements, autoRepair)
      setProject(result.project)
      setValidation(result.validation)
      setFixReport(result)
      notify(result.project.review.approved ? '自动审核通过，可以进入视频生成' : '审核完成，请查看逐项结果与待补资料', result.project.review.approved ? 'ok' : 'error')
    } catch (error: any) { notify(error.message, 'error') }
    finally { setFixing(null) }
  }

  const panel = <AutomaticReviewPanel project={project} meta={meta} patch={patch} runReview={runReview} busy={fixing !== null} goto={goto} onRules={() => gotoFoundation?.('compliance')} notify={notify} />
  useEffect(() => {
    load()
  }, [project.updatedAt, project.id])

  if (!sb || preview) return panel

  const blockers = validation?.summary.blockers || 0
  return (
    <>
      {panel}
      <details className="stage-disclosure" open={blockers > 0 || undefined}><summary>规则扫描明细 · {blockers} 项阻断 / {validation?.summary.warnings || 0} 项提醒</summary><Section
        title="规则扫描问题"
        desc="这些问题也会纳入上方自动审核。需要单独处理时，可在此定位并修复。"
        right={
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone={blockers ? 'red' : 'green'}>阻断 {blockers}</Badge>
            <Badge tone={validation?.summary.warnings ? 'amber' : 'slate'}>提醒 {validation?.summary.warnings || 0}</Badge>
            <button className="btn-ghost !py-1 !text-xs" onClick={load} disabled={loading || fixing !== null}>
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
                  App 界面与 Logo 禁止 AI 生成。<span className="text-slate-300">推荐</span>：回到品牌素材上传真实截图/录屏。
                  若本次先不展示界面，可用下面的「移除未上传素材引用并修复」，系统会移除引用并同步调整文案。
                </p>
                <button
                  className="btn-ghost !py-1 !text-[11px] mt-2"
                  onClick={() => runFix({ removeMissingAssets: true })}
                  disabled={fixing !== null || !!project.experimentLink}
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
                      onFix={g.fix?.auto && !project.experimentLink ? () => runFix({}) : undefined}
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
                        disabled={fixing !== null || !!project.experimentLink}
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
                <Badge tone="amber">待补充 {fixReport.report.needsManual.length}</Badge>
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
                    <button className="ml-2 text-[10px] text-brand hover:text-brand-soft" onClick={() => gotoFoundation?.('assets')}>
                      去上传 →
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Section></details>

      {(blockers > 0 || project.review.status === 'blocked') && <div className="phase-scope-note">需要手动修改画面或文案？<button className="text-link" onClick={() => goto(4)}>返回分镜修改 →</button></div>}
    </>
  )
}
