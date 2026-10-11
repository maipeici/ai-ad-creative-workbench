import { useEffect, useRef, useState } from 'react'
import ReferenceGuidance from '../components/ReferenceGuidance'
import type { PhaseProps } from '../App'
import { api } from '../api'
import type { ShotRender } from '../types'
import { Badge, CopyButton, EmptyHint, Field, Modal, RenderModeBadge, RoleBadge, Section, Spinner } from '../ui'
import { buildMaterialName } from '../utils'

const STATUS_TONE: Record<string, string> = {
  succeeded: 'green',
  running: 'blue',
  failed: 'red',
  manual: 'amber',
  simulated: 'amber',
}
const STATUS_TEXT: Record<string, string> = {
  succeeded: '已生成',
  running: '生成中',
  failed: '失败',
  manual: '待手动生成',
  simulated: '已模拟',
}

export default function Phase6Render({ project, meta, patch, setProject, notify, goto, preview }: PhaseProps) {
  const sb = project.storyboard
  const [busyShot, setBusyShot] = useState<string | null>(null)
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 })
  const [assembling, setAssembling] = useState(false)
  const [manualFor, setManualFor] = useState<string | null>(null)
  const [manualUrl, setManualUrl] = useState('')
  const [manualCmd, setManualCmd] = useState<{ listFileContent: string; command: string } | null>(null)
  const [variantVar, setVariantVar] = useState('hook')
  const [variantIns, setVariantIns] = useState('')
  const [variantBusy, setVariantBusy] = useState(false)

  const runningKey = Object.entries(project.render?.shots || {})
    .filter(([, r]) => r.status === 'running' && r.taskId)
    .map(([id]) => id)
    .join(',')
  const pollingRef = useRef(false)

  useEffect(() => {
    if (!runningKey || preview) return
    let cancelled = false
    const tick = async () => {
      if (pollingRef.current) return
      pollingRef.current = true
      try {
        for (const shotId of runningKey.split(',')) {
          if (cancelled) break
          try {
            const { project: p } = await api.pollShot(project.id, shotId)
            setProject(p)
          } catch {
            /* 下一轮继续 */
          }
        }
      } finally {
        pollingRef.current = false
      }
    }
    const timer = setInterval(tick, 12000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [runningKey, project.id, setProject])

  if (!sb) return <EmptyHint>还没有分镜，请先完成 Phase 4 / 5。</EmptyHint>

  const renders = project.render?.shots || {}
  const staleConcept = Boolean(sb.conceptId && sb.conceptId !== project.selectedConceptId)
  const approved = project.review?.approved && !staleConcept
  const pendingShots = sb.shots.filter(s => s.renderMode !== 'asset' && (!renders[s.id]?.url || renders[s.id]?.stale) && !['running', 'manual'].includes(renders[s.id]?.status || ''))
  const doneCount = sb.shots.filter((s) => renders[s.id]?.url && !renders[s.id]?.stale).length
  const approvedCount = sb.shots.filter((s) => renders[s.id]?.approved).length
  const needOverlay = sb.shots.filter((s) => s.renderMode === 'overlay' && !renders[s.id]?.stale && renders[s.id]?.url && !renders[s.id]?.overlayApplied)

  const renderShot = async (shotId: string) => {
    if (!approved || busyShot || batchRunning) return
    setBusyShot(shotId)
    try {
      const { project: p } = await api.renderShot(project.id, shotId)
      setProject(p)
      const r = p.render.shots[shotId]
      if (r?.status === 'failed') notify(`镜头生成失败：${r.error}`, 'error')
    } catch (e: any) {
      notify(e.message, 'error')
    } finally {
      setBusyShot(null)
    }
  }

  const renderAll = async () => {
    if (!approved || batchRunning || !pendingShots.length) return
    setBatchRunning(true)
    setBatchProgress({ done: 0, total: pendingShots.length })
    let submitted = 0, failed = 0
    try {
      for (const [index, s] of pendingShots.entries()) {
        setBusyShot(s.id)
        try {
          const { project: p } = await api.renderShot(project.id, s.id)
          setProject(p)
          if (p.render.shots[s.id]?.status === 'failed') failed++
          else submitted++
        } catch { failed++ }
        setBatchProgress({ done: index + 1, total: pendingShots.length })
      }
      notify('已提交 ' + submitted + ' 个镜头' + (failed ? '，' + failed + ' 个失败，请查看对应镜头' : '；已完成的镜头已保留'), failed ? 'error' : 'ok')
    } finally {
      setBusyShot(null)
      setBatchRunning(false)
    }
  }
  const doOverlay = async (shotId: string) => {
    setBusyShot(shotId)
    try {
      const { project: p } = await api.overlayShot(project.id, shotId)
      setProject(p)
      notify('字幕与素材已叠加')
    } catch (e: any) {
      notify(e.message, 'error')
    } finally {
      setBusyShot(null)
    }
  }

  const overlayAll = async () => {
    for (const s of needOverlay) {
      setBusyShot(s.id)
      try {
        const { project: p } = await api.overlayShot(project.id, s.id)
        setProject(p)
      } catch (e: any) {
        notify(`#${s.index} ${e.message}`, 'error')
      }
    }
    setBusyShot(null)
    notify('批量叠加完成')
  }

  const assemble = async (force = false) => {
    setAssembling(true)
    setManualCmd(null)
    try {
      const res = await api.assemble(project.id, force)
      setProject(res.project)
      if (res.ffmpeg === false && res.manual) {
        setManualCmd(res.manual)
        notify('未检测到 ffmpeg，已生成手动合成命令', 'error')
      } else {
        notify('成片与封面已生成')
      }
    } catch (e: any) {
      notify(e.message, 'error')
    } finally {
      setAssembling(false)
    }
  }

  const createVariant = async () => {
    setVariantBusy(true)
    try {
      const { project: p, variant } = await api.createVariant(project.id, variantVar, variantIns)
      setProject(p)
      setVariantIns('')
      notify(`已创建变体：${variant.variantName}`)
    } catch (e: any) {
      notify(e.message, 'error')
    } finally {
      setVariantBusy(false)
    }
  }

  const materialName = buildMaterialName({
    audience: meta.brandGuide.audienceOptions.find((a) => a.id === project.brief.audience)?.name,
    scene: meta.brandGuide.sceneOptions.find((s) => s.id === project.brief.scene)?.name,
    version: 1,
  })

  return (
    <>
      <ReferenceGuidance reference={sb.inspiration} stage="video"/>
      {staleConcept&&<div className="inspiration-notice">当前创意已切换，已有视频保留。请回到分镜阶段生成新方案的分镜。<button className="btn-ghost" onClick={()=>goto(4)}>前往分镜 →</button></div>}
      {!preview && !meta.ffmpeg && <div className="rounded-xl border border-amber-900/60 bg-amber-950/20 px-4 py-3 text-xs text-amber-200 leading-relaxed" role="status"><strong>视频合成待配置</strong><p className="mt-1 text-amber-200/70">本机尚未安装视频合成工具。已有成片可以播放和下载，新的字幕叠加与成片合成暂不可用。</p></div>}
      {Object.values(renders).some(render => render.stale) && <p className="foundation-notice">自动审核修复了部分分镜。对应旧镜头与成片保留供回看，请重新生成或回传标记为待更新的镜头，再合成新版。</p>}
      <Section
        title="生成设置"
        desc="选择口播音色，再生成待完成的镜头。字幕、品牌素材与配音会在合成时自动加入。"
        right={<Badge tone={approved ? 'green' : 'red'}>{approved ? '分镜已审核' : '分镜未审核'}</Badge>}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="口播音色" hint={meta.ttsEnabled ? '合成时自动为每个镜头配音' : '配音暂不可用，请检查模型配置'}>
            <select className="input" value={project.render?.voicePreset || 'relatable-female'} onChange={e => patch({ render: { ...project.render, voicePreset: e.target.value } })} disabled={!meta.ttsEnabled}>
              {(meta.voices || []).map(v => <option key={v.id} value={v.id} title={v.desc}>{v.name}</option>)}
            </select>
          </Field>
          <Field label="生成与导出">
            <div className="flex gap-2">
              <button className="btn-primary flex-1" onClick={renderAll} disabled={batchRunning || !!busyShot || !approved || !pendingShots.length}>
                {batchRunning && <Spinner />}{batchRunning ? '提交中 ' + batchProgress.done + '/' + batchProgress.total : pendingShots.length ? '生成待完成镜头（' + pendingShots.length + '）' : '全部镜头已提交'}
              </button>
              <a className="btn-ghost" href={'/api/projects/' + project.id + '/package?download=1'} download>导出包</a>
            </div>
          </Field>
        </div>
        {!approved && <p className="mt-3 text-xs text-amber-400">分镜尚未审核，请先完成审核再开始生成。<button className="underline ml-2" onClick={() => goto(5)}>去审核 →</button></p>}
        <details className="mt-4 rounded-lg border border-ink-600 bg-ink-900/40 p-3">
          <summary className="cursor-pointer text-xs text-slate-400">高级生成设置</summary>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <Field label="视频生成模型" hint="留空使用当前配置">
              <input className="input" placeholder={meta.vertex?.veoModel || meta.providers.video} defaultValue={project.render?.model || ''} onBlur={e => patch({ render: { ...project.render, model: e.target.value } })} />
            </Field>
            <Field label="其他模型参数（JSON，可选）">
              <input className="input font-mono !text-xs" placeholder='{"generateAudio":false}' defaultValue={JSON.stringify(project.render?.params || {})} onBlur={e => {
                try { patch({ render: { ...project.render, params: e.target.value ? JSON.parse(e.target.value) : {} } }) }
                catch { notify('参数 JSON 格式错误', 'error') }
              }} />
            </Field>
          </div>
        </details>
        <p className="mt-3 text-[11px] text-slate-500">批量生成会保留已有镜头，只提交尚未完成的部分。需要调整时，可在下方单独重新生成对应镜头。</p>
        <p className="mt-2 text-[11px] text-slate-600">建议素材命名：<code className="text-brand-soft">{materialName}.mp4</code></p>
      </Section>
      <Section
        title={`镜头生成与审核（${doneCount}/${sb.shots.length} 已生成 · ${approvedCount} 已通过）`}
        desc="每个镜头独立生成、独立叠加、独立审核。只有问题镜头需要重跑。"
        right={
          needOverlay.length > 0 ? (
            <button className="btn-primary !py-1 !text-xs" onClick={overlayAll}>
              批量叠加 {needOverlay.length} 镜
            </button>
          ) : null
        }
      >
        <div className="space-y-2">
          {sb.shots.map((shot) => {
            const r: ShotRender | undefined = renders[shot.id]
            const needsOv = shot.renderMode === 'overlay' && r?.url && !r?.overlayApplied
            return (
              <div key={shot.id} className={`bg-ink-900 border rounded-lg p-3 ${needsOv ? 'border-brand/50' : 'border-ink-600'}`}>
                <div className="flex gap-3">
                  <div className="w-24 shrink-0 aspect-[9/16] bg-ink-800 rounded overflow-hidden grid place-items-center">
                    {r?.url ? (
                      <video src={r.url} className="w-full h-full object-cover" controls muted />
                    ) : shot.preview?.url ? (
                      <img src={shot.preview.url} alt="" className="w-full h-full object-cover opacity-50" />
                    ) : (
                      <span className="text-[10px] text-slate-600">#{shot.index}</span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge tone="brand">#{shot.index}</Badge>
                      <RoleBadge role={shot.role} />
                      <RenderModeBadge mode={shot.renderMode} />
                      <span className="text-xs font-medium text-slate-200 truncate">{shot.titleCn}</span>
                      <Badge>{shot.durationSec}s</Badge>
                      {r && <Badge tone={STATUS_TONE[r.status] || 'slate'}>{STATUS_TEXT[r.status] || r.status}</Badge>}
                      {r?.stale && <Badge tone="amber">分镜已更新 · 待重新制作</Badge>}
                      {r?.status === 'running' && <Spinner className="text-sky-400" />}
                      {r?.usedFirstFrame && <Badge tone="blue">图生视频</Badge>}
                      {r?.overlayApplied && <Badge tone="green">✓ 已叠加</Badge>}
                      {r?.approved && <Badge tone="green">✓ 已通过</Badge>}
                    </div>

                    {r?.overlayInfo && (
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {r.overlayInfo.subtitle && <Badge tone="brand">字幕</Badge>}
                        {(r.overlayInfo.images || 0) > 0 && (
                          <Badge tone="blue">素材×{r.overlayInfo.images}</Badge>
                        )}
                        {r.overlayInfo.watermark && <Badge tone="slate">Logo角标</Badge>}
                        {r.overlayInfo.vo ? (
                          <Badge tone={r.overlayInfo.vo.overflow ? 'amber' : 'green'}>
                            配音 {r.overlayInfo.vo.voiceName} · {r.overlayInfo.vo.estimatedSec}s
                            {r.overlayInfo.vo.overflow ? ' ⚠超长' : ''}
                          </Badge>
                        ) : (
                          r.overlayInfo.voError && <Badge tone="red">配音失败</Badge>
                        )}
                      </div>
                    )}
                    {r?.overlayInfo?.imageNames?.length ? (
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        已叠加：{r.overlayInfo.imageNames.join('、')}
                      </p>
                    ) : null}

                    {shot.vo && <p className="text-[11px] text-slate-400 mt-1">口播：{shot.vo}</p>}
                    {shot.subtitle && <p className="text-[11px] text-slate-300 mt-0.5">字幕：{shot.subtitle}</p>}
                    {(shot.overlayItems || []).length > 0 && (
                      <p className="text-[10px] text-brand-soft mt-0.5">需叠加：{shot.overlayItems.join(' / ')}</p>
                    )}
                    {r?.message && <p className="text-[11px] text-amber-400 mt-1">{r.message}</p>}
                    {r?.error && <p className="text-[11px] text-red-400 mt-1">{r.error}</p>}
                    {needsOv && <p className="text-[11px] text-brand mt-1">该镜头需要叠加字幕与素材后才能用于成片</p>}

                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {shot.renderMode !== 'asset' && (
                        <button className="btn-ghost !py-1 !text-[11px]" onClick={() => renderShot(shot.id)} disabled={!!busyShot || batchRunning || !approved || (r?.status === 'running' && !r?.stale)}>
                          {busyShot === shot.id ? <Spinner /> : r?.url ? '↻' : '▶'} {r?.url ? '重新生成' : '生成本镜'}
                        </button>
                      )}
                      {r?.url && shot.renderMode === 'overlay' && (
                        <button className="btn-primary !py-1 !text-[11px]" onClick={() => doOverlay(shot.id)} disabled={!!busyShot || batchRunning}>
                          {busyShot === shot.id ? <Spinner /> : '⧉'} {r.overlayApplied ? '重新叠加' : '叠加字幕素材'}
                        </button>
                      )}
                      {r?.taskId && r.status === 'running' && (
                        <button className="btn-ghost !py-1 !text-[11px]" onClick={async () => setProject((await api.pollShot(project.id, shot.id)).project)}>
                          查询状态
                        </button>
                      )}
                      <button
                        className="btn-ghost !py-1 !text-[11px]"
                        onClick={() => {
                          setManualFor(shot.id)
                          setManualUrl(r?.url || '')
                        }}
                      >
                        回传素材
                      </button>
                      {r?.compiled && <CopyButton text={r.compiled.prompt} label="复制 Prompt" />}
                      {r?.url && (
                        <>
                          <button
                            className={`btn ${r.approved ? 'btn-ghost' : 'btn-primary'} !py-1 !text-[11px]`}
                            disabled={r.stale} onClick={async () => setProject(await api.approveShotRender(project.id, shot.id, !r.approved))}
                          >
                            {r.approved ? '撤销通过' : '✓ 审核通过'}
                          </button>
                          <a className="btn-ghost !py-1 !text-[11px]" href={r.url} download target="_blank" rel="noreferrer">
                            下载
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </Section>

      <Section
        title="成片合成"
        dataGuide="assembly"
        desc="按分镜顺序拼接通过审核的镜头，输出 1080x1920 成片并自动抽取封面。"
        right={
          <div className="flex gap-2">
            <button className="btn-primary" onClick={() => assemble(false)} disabled={assembling}>
              {assembling && <Spinner />} 合成成片
            </button>
            <button className="btn-ghost" onClick={() => assemble(true)} disabled={assembling}>
              强制合成
            </button>
          </div>
        }
      >
        {project.render?.finalVideo ? (
          <div className="flex gap-5 flex-wrap">
            <video src={project.render.finalVideo.url} controls className="w-44 rounded-lg border border-ink-600 bg-black" />
            {project.render.cover && (
              <div>
                <div className="label">封面首帧</div>
                <img src={project.render.cover} alt="" className="w-28 rounded-lg border border-ink-600" />
                <a className="btn-ghost !py-1 !text-[11px] mt-2 w-full" href={project.render.cover} download>
                  下载封面
                </a>
              </div>
            )}
            <div className="space-y-2 text-xs text-slate-400">
              <div>镜头数：{project.render.finalVideo.shotCount}</div>
              <div>时长：{project.render.finalVideo.durationSec.toFixed(1)}s</div>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="brand">字幕 {project.render.finalVideo.subtitleCount ?? 0} 镜</Badge>
                <Badge tone="green">配音 {project.render.finalVideo.voCount ?? 0} 镜</Badge>
                <Badge tone="blue">素材 {project.render.finalVideo.assetCount ?? 0} 镜</Badge>
              </div>
              <div>合成于：{new Date(project.render.finalVideo.assembledAt).toLocaleString('zh-CN')}</div>
              <a className="btn-primary !py-1 !text-xs" href={project.render.finalVideo.url} download>
                下载成片
              </a>
            </div>
          </div>
        ) : (
          <EmptyHint>
            所有镜头生成、叠加并通过审核后即可合成。
            {!meta.ffmpeg && <span className="block mt-2 text-amber-400">当前环境未安装 ffmpeg，叠加与合成不可用。</span>}
            {!meta.subtitleFont && <span className="block mt-2 text-amber-400">未找到中文字体，字幕无法烧录。</span>}
          </EmptyHint>
        )}

        {manualCmd && (
          <div className="mt-4 space-y-2">
            <div className="label">手动合成：保存为 data/runtime/media/shots.txt</div>
            <pre className="text-[10px] font-mono bg-ink-900 border border-ink-600 rounded p-3 overflow-x-auto">
              {manualCmd.listFileContent}
            </pre>
            <div className="flex gap-2">
              <pre className="flex-1 text-[10px] font-mono bg-ink-900 border border-ink-600 rounded p-3 overflow-x-auto">
                {manualCmd.command}
              </pre>
              <CopyButton text={manualCmd.command} />
            </div>
          </div>
        )}
      </Section>

      <Section
        title="单变量创意测试"
        desc="只替换一个维度，其余镜头完全复用，保证投放数据可归因。"
        right={<Badge tone={project.variants?.length ? 'blue' : 'slate'}>{project.variants?.length || 0} 个变体</Badge>}
      >
        <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr_auto] gap-3 items-end">
          <Field label="测试变量">
            <select className="input w-40" value={variantVar} onChange={(e) => setVariantVar(e.target.value)}>
              {meta.brandGuide.testVariableOptions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="变体要求（可选）">
            <input
              className="input"
              placeholder="例如：钩子改成利益前置、CTA 改成更直接的说法"
              value={variantIns}
              onChange={(e) => setVariantIns(e.target.value)}
            />
          </Field>
          <button className="btn-primary" onClick={createVariant} disabled={variantBusy}>
            {variantBusy && <Spinner />} 生成变体
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-600">
          {meta.brandGuide.testVariableOptions.find((v) => v.id === variantVar)?.desc}
        </p>

        {(project.variants || []).length > 0 && (
          <div className="mt-4 space-y-2">
            {project.variants.map((v) => (
              <div key={v.id} className="bg-ink-900 border border-ink-600 rounded-lg p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge tone="blue">{meta.brandGuide.testVariableOptions.find((o) => o.id === v.variable)?.name || v.variable}</Badge>
                  <span className="text-xs font-medium text-slate-200">{v.variantName}</span>
                  <button
                    className="ml-auto text-[11px] text-slate-600 hover:text-red-400"
                    onClick={async () => setProject(await api.deleteVariant(project.id, v.id))}
                  >
                    删除
                  </button>
                </div>
                <p className="text-[11px] text-sky-300/80 mt-1.5">🧪 {v.hypothesis}</p>
                <p className="text-[11px] text-slate-400 mt-1">{v.changeSummary}</p>
                <div className="flex gap-3 mt-2 text-[10px] text-slate-500">
                  <span>
                    变化镜头：{v.changedShotIndexes?.length ? v.changedShotIndexes.map((i) => `#${i}`).join(' ') : '—'}
                  </span>
                  <span>
                    固定镜头：{v.fixedShotIndexes?.length ? v.fixedShotIndexes.map((i) => `#${i}`).join(' ') : '—'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="发现问题？回到对应阶段" desc="工作流支持局部迭代，修改全局设定时系统会标记受影响的镜头。">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {[
            [1, '更换素材 / 事实', 'Foundation'],
            [2, '修改投放需求', 'Brief'],
            [3, '调整创意方向', 'Concept'],
            [4, '修改分镜', 'Storyboard'],
            [5, '重新审核', 'Review'],
          ].map(([id, label, sub]) => (
            <button key={id as number} className="card p-3 text-left hover:border-brand/50 transition-colors" onClick={() => goto(id as number)}>
              <div className="text-xs font-medium text-slate-200">{label}</div>
              <div className="text-[10px] text-slate-600 mt-0.5">
                Phase {id} · {sub}
              </div>
            </button>
          ))}
        </div>
      </Section>

      <Modal open={!!manualFor} title="回传已确认素材或外部生成视频" onClose={() => setManualFor(null)}>
        <div className="space-y-3">
          <p className="text-xs text-slate-500 leading-relaxed">
            在这里接入已确认的素材片段，或外部平台生成的视频。
            建议放到 <code className="text-brand-soft">data/runtime/media/</code> 并填 <code className="text-brand-soft">/media/文件名.mp4</code>，
            这样才能参与本地叠加与合成。
          </p>
          <input
            className="input font-mono !text-xs"
            placeholder="/media/shot-1.mp4 或 https://..."
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setManualFor(null)}>
              取消
            </button>
            <button
              className="btn-primary"
              onClick={async () => {
                if (!manualFor || !manualUrl) return
                setProject(await api.attachShotVideo(project.id, manualFor, manualUrl))
                setManualFor(null)
                notify('素材已接入')
              }}
            >
              保存
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
