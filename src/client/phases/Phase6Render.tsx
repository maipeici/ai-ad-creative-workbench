import { useEffect, useRef, useState } from 'react'
import ReferenceGuidance from '../components/ReferenceGuidance'
import FinalQualityPanel from '../components/FinalQualityPanel'
import BatchPanel from '../components/BatchPanel'
import type { PhaseProps } from '../App'
import { api } from '../api'
import type { ShotRender } from '../types'
import { Badge, CopyButton, DetailsWhen, EmptyHint, Field, Modal, RenderModeBadge, RoleBadge, Section, Spinner } from '../ui'
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

export default function Phase6Render(props: PhaseProps) {
  if (props.preview || props.project.experimentLink) return <SingleVideoProduction {...props} />
  if (props.videoDetail) return <><div className="version-detail-heading"><button className="text-link" onClick={props.closeVideoDetail}>← 返回整批视频</button><h2>{props.project.creativeName || '当前视频版本'}</h2><p>这里只调整当前版本的镜头与成片；整批生产进度在视频列表中查看。</p></div><SingleVideoProduction {...props} /></>
  return <BatchPanel project={props.project} phase={6} production ffmpeg={props.meta.ffmpeg} onOpen={async (id, phase) => phase === 6 ? props.inspectVideo?.(id) : props.openMaterial?.(id, phase)} onUpdate={props.setProject} notify={props.notify} beforeOpen={async () => {}} onExperiment={props.openExperiments} />
}

function SingleVideoProduction({ project, meta, patch, setProject, notify, goto, preview, openExperiments }: PhaseProps) {
  const sb = project.storyboard
  const [busyShot, setBusyShot] = useState<string | null>(null)
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 })
  const [assembling, setAssembling] = useState(false)
  const [manualFor, setManualFor] = useState<string | null>(null)
  const [manualUrl, setManualUrl] = useState('')
  const [manualCmd, setManualCmd] = useState<{ listFileContent: string; command: string } | null>(null)

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

  const finalVideo = project.render?.finalVideo
  const deliveryActions = project.experimentLink && finalVideo && <button className="btn-ghost" onClick={openExperiments}>返回素材测试 →</button>
  if (!sb) return <><EmptyHint>当前素材还没有分镜。<button className="text-link ml-2" onClick={() => goto(4)}>前往分镜规划 →</button></EmptyHint>{deliveryActions}</>

  const renders = project.render?.shots || {}
  const staleConcept = Boolean(sb.conceptId && sb.conceptId !== project.selectedConceptId)
  const approved = project.review?.approved && !staleConcept
  const lockedShot = (id: string) => Boolean(project._experimentRenderLocked || project.experimentLink && project.experimentLink.label !== 'A' && !project.experimentLink.editableShotIds.includes(id))
  const pendingShots = sb.shots.filter(s => !lockedShot(s.id) && s.renderMode !== 'asset' && (!renders[s.id]?.url || renders[s.id]?.stale) && !['running', 'manual'].includes(renders[s.id]?.status || ''))
  const doneCount = sb.shots.filter((s) => renders[s.id]?.url && !renders[s.id]?.stale).length

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
      notify('字幕、品牌素材与配音已更新，请重新合成此版本成片')
    } catch (e: any) {
      notify(e.message, 'error')
    } finally {
      setBusyShot(null)
    }
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
        notify('成片已生成，正在自动检查画面与声音…')
        try { setProject(await api.reviewFinalVideo(project.id)); notify('成片质检完成，请查看逐项结果') } catch (error: any) { notify('成片已保存；质检未完成：' + error.message, 'error') }
      }
    } catch (e: any) {
      notify(e.message, 'error')
    } finally {
      setAssembling(false)
    }
  }

  const materialName = buildMaterialName({
    audience: meta.brandGuide.audienceOptions.find((a) => a.id === project.brief.audience)?.name,
    scene: meta.brandGuide.sceneOptions.find((s) => s.id === project.brief.scene)?.name,
    version: 1,
  })

  return (
    <>
      {project._experimentRenderLocked && <p className="business-context">A 版已被其他实验版本引用，视频保持锁定。仍可查看、质检和导出；需要更换基准时，请回源任务建立新实验。</p>}
      {staleConcept&&<div className="inspiration-notice">当前创意已切换，已有视频保留。请回到分镜阶段生成新方案的分镜。<button className="btn-ghost" onClick={()=>goto(4)}>前往分镜 →</button></div>}

      {Object.values(renders).some(render => render.stale) && <p className="foundation-notice">自动审核修复了部分分镜。对应旧镜头与成片保留供回看，请重新生成或回传标记为待更新的镜头，再合成新版。</p>}
      <DetailsWhen when={!!finalVideo && !finalVideo.stale && !runningKey && !batchRunning} label="调整镜头与生成设置">
      <ReferenceGuidance reference={sb.inspiration} stage="video"/>
      {!preview && !meta.ffmpeg && <div className="rounded-xl border border-amber-900/60 bg-amber-950/20 px-4 py-3 text-xs text-amber-200 leading-relaxed" role="status"><strong>视频合成待配置</strong><p className="mt-1 text-amber-200/70">本机尚未安装视频合成工具。已有成片可以播放和下载，新的字幕叠加与成片合成暂不可用。</p></div>}
      <Section
        title="生成设置"
        desc="选择口播音色，再生成待完成的镜头。字幕、品牌素材与配音会在合成时自动加入。"
        right={<Badge tone={approved ? 'green' : 'red'}>{approved ? '分镜已审核' : '分镜未审核'}</Badge>}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="口播音色" hint={meta.ttsEnabled ? '合成时自动为每个镜头配音' : '配音暂不可用，请检查模型配置'}>
            <select className="input" value={project.render?.voicePreset || 'relatable-female'} onChange={e => patch({ render: { ...project.render, voicePreset: e.target.value } })} disabled={!meta.ttsEnabled || !!project.experimentLink}>
              {(meta.voices || []).map(v => <option key={v.id} value={v.id} title={v.desc}>{v.name}</option>)}
            </select>
          </Field>
          <Field label="镜头生成">
            <div className="flex gap-2">
              <button className="btn-primary flex-1" onClick={renderAll} disabled={batchRunning || !!busyShot || !approved || !pendingShots.length}>
                {batchRunning && <Spinner />}{batchRunning ? '提交中 ' + batchProgress.done + '/' + batchProgress.total : pendingShots.length ? '生成待完成镜头（' + pendingShots.length + '）' : '全部镜头已提交'}
              </button>
            </div>
          </Field>
        </div>
        {!approved && <p className="mt-3 text-xs text-amber-400">分镜尚未审核，请先完成审核再开始生成。<button className="underline ml-2" onClick={() => goto(5)}>去审核 →</button></p>}
        <details className="mt-4 rounded-lg border border-ink-600 bg-ink-900/40 p-3">
          <summary className="cursor-pointer text-xs text-slate-400">高级生成设置</summary>
          <fieldset disabled={!!project.experimentLink} className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <Field label="视频生成模型" hint="留空使用当前配置">
              <input className="input" placeholder={meta.vertex?.veoModel || meta.providers.video} defaultValue={project.render?.model || ''} onBlur={e => patch({ render: { ...project.render, model: e.target.value } })} />
            </Field>
            <Field label="其他模型参数（JSON，可选）">
              <input className="input font-mono !text-xs" placeholder='{"generateAudio":false}' defaultValue={JSON.stringify(project.render?.params || {})} onBlur={e => {
                try { patch({ render: { ...project.render, params: e.target.value ? JSON.parse(e.target.value) : {} } }) }
                catch { notify('参数 JSON 格式错误', 'error') }
              }} />
            </Field>
          </fieldset>
        </details>
        <p className="mt-3 text-[11px] text-slate-500">生成时会保留已有镜头，只提交尚未完成的部分。需要调整时，可在下方单独重新生成对应镜头。</p>
      </Section>
      <Section
        title={`镜头制作（${doneCount}/${sb.shots.length} 已就绪）`}
        desc="保留已完成镜头，只重做需要修改的部分；合成后统一检查成片。"
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
                      {r?.overlayApplied && <Badge tone="green">字幕配音已加入</Badge>}
                      {lockedShot(shot.id) && <Badge tone="blue">固定镜头</Badge>}
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
                    {r?.message && (!r.url || r.status === 'running' || r.status === 'failed') && <p className="text-[11px] text-amber-400 mt-1">{r.message}</p>}
                    {r?.error && <p className="text-[11px] text-red-400 mt-1">{r.error}</p>}
                    {needsOv && <p className="text-[11px] text-slate-400 mt-1">合成时会自动加入字幕、品牌素材与配音</p>}

                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {shot.renderMode !== 'asset' && (
                        <button className="btn-ghost !py-1 !text-[11px]" onClick={() => renderShot(shot.id)} disabled={lockedShot(shot.id) || !!busyShot || batchRunning || !approved || (r?.status === 'running' && !r?.stale)}>
                          {busyShot === shot.id ? <Spinner /> : r?.url ? '↻' : '▶'} {r?.url ? '重新生成' : '生成本镜'}
                        </button>
                      )}
                      {r?.url && shot.renderMode === 'overlay' && (
                        <button className="btn-ghost !py-1 !text-[11px]" title="基于原镜头更新字幕、品牌素材与配音，不会重新生成画面；随后需重新合成成片。" onClick={() => doOverlay(shot.id)} disabled={lockedShot(shot.id) || !!busyShot || batchRunning}>
                          {busyShot === shot.id && <Spinner />}更新字幕与配音
                        </button>
                      )}
                      {r?.taskId && r.status === 'running' && (
                        <button className="btn-ghost !py-1 !text-[11px]" onClick={async () => setProject((await api.pollShot(project.id, shot.id)).project)}>
                          查询状态
                        </button>
                      )}
                      <button
                        className="btn-ghost !py-1 !text-[11px]"
                        disabled={lockedShot(shot.id)}
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

      </DetailsWhen>
      <Section
        title={finalVideo ? '成片预览与下载' : '成片合成'}
        dataGuide="assembly"
        desc="按分镜顺序合成视频、字幕与配音，提取封面后自动发起成片质检。"
        right={
          <div className="flex gap-2">
            <button className="btn-primary" onClick={() => assemble(false)} disabled={assembling || project._experimentRenderLocked || !approved || !meta.ffmpeg}>
              {assembling && <Spinner />} {finalVideo ? '重新合成并质检' : '合成并自动质检'}
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
              {!finalVideo?.stale && <a className="btn-ghost !py-1 !text-xs ml-2" href={`/api/projects/${project.id}/delivery.zip`} download>下载交付包 ZIP</a>}
              <p className="business-help">交付包包含成片与当前质检报告，下载不代表已通过平台审核。</p>
            </div>
          </div>
        ) : (
          <EmptyHint>
            完成自动审核与镜头制作后即可合成。
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

      {finalVideo && <FinalQualityPanel project={project} onUpdate={setProject} notify={notify} goto={goto} />}
      {deliveryActions}
      <details className="stage-disclosure"><summary>导出创作数据与历史草稿</summary><div className="p-4 space-y-3"><p className="business-help">保存脚本、生成指令与素材引用，供归档或外部工具接续制作。</p><a className="btn-ghost" href={'/api/projects/' + project.id + '/package?download=1'} download>导出创作数据 JSON</a><p className="business-help">建议素材命名：{materialName}.mp4</p>{project.variants?.length > 0 && <details><summary>历史变体草稿（{project.variants.length}）</summary>{project.variants.map(v => <p key={v.id} className="business-help">{v.variantName}：{v.hypothesis} · {v.changeSummary}</p>)}</details>}</div></details>

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
