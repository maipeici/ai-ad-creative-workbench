import { randomUUID } from 'node:crypto'
import { failure } from './experiments.js'
import { assertStoryboardCurrent } from './inspiration-guidance.js'
import { makeVersionPlan, VERSION_CHANGES } from './video-versions.js'

// The original project's video remains in place. Additional creatives are nested
// records, projected through the existing single-video endpoints for compatibility.
export const CREATIVE_FIELDS = ['creativeName', 'creativeInstruction', 'versionPlan', 'sharedSnapshot', 'phase', 'concepts', 'selectedConceptId', 'storyboard', 'review', 'render', 'variants', 'experimentLink', 'createdAt', 'updatedAt']
export function creativeRecord(project) {
  return Object.fromEntries(['id', ...CREATIVE_FIELDS].filter(key => project[key] !== undefined).map(key => [key, structuredClone(project[key])]))
}
export function projectCreative(parent, creative) {
  const { creatives, batch, batchJob, experiments, ...shared } = parent
  return { ...shared, ...creative.sharedSnapshot, ...structuredClone(creative), name: parent.name, batchId: parent.id, batchName: parent.name }
}
export function flattenCreatives(projects) {
  return projects.flatMap(parent => [parent, ...(parent.creatives || []).map(item => projectCreative(parent, item))])
}
export function creativeSummary(project) {
  const shots = project.storyboard?.shots || []
  const video = project.render?.finalVideo
  return {
    id: project.id, name: project.creativeName || project.concepts?.find(c => c.id === project.selectedConceptId)?.title || '素材 01',
    conceptId: project.selectedConceptId, instruction: project.creativeInstruction || '', phase: project.phase, scriptSource: project.storyboard?.source || '',
    shotCount: shots.length, readyShots: shots.filter(s => project.render?.shots?.[s.id]?.url && !project.render.shots[s.id].stale).length,
    approved: Boolean(project.review?.approved), reviewStatus: project.review?.status || 'idle',
    videoUrl: video?.url || null, stale: Boolean(video?.stale), cover: project.render?.cover || null,
    qualityStatus: project.render?.qualityReview?.status || 'idle', experimentLink: project.experimentLink || null,
  }
}
export function batchView(parent) {
  const items = [parent, ...(parent.creatives || []).map(item => projectCreative(parent, item))]
  return { id: parent.id, name: parent.name, target: Math.max(Number(parent.brief?.deliveryCount) || 1, items.length), items: items.map(creativeSummary), job: parent.batchJob || null }
}
export function createBatch(parent, input) {
  if (parent.batchId || parent.experimentLink) throw failure('请在项目的基础分镜中设置视频版本')
  if (input.conceptIds?.some(id => id !== parent.selectedConceptId)) throw failure('一个项目只能使用一条核心创意')
  const count = Number(input.versionCount)
  const existing = (parent.creatives?.length || 0) + 1
  if (!Number.isInteger(count) || count < Math.max(2, existing) || count > 60) throw failure(`请输入 ${Math.max(2, existing)}–60 个视频版本；已建版本会保留`)
  const plan = parent.versionPlan || makeVersionPlan(parent, input)
  if (parent.creatives?.some(c => c.selectedConceptId !== parent.selectedConceptId)) throw failure('旧项目包含多个创意，请先按创意拆分项目')
  const instructions = Array.isArray(input.instructions) ? input.instructions : []
  const records = []
  for (let i = existing; i < count; i++) {
    const concept = plan.concept
    const record = {
      id: randomUUID(), creativeName: `${concept.title} · 版本 ${i + 1}`,
      creativeInstruction: String(instructions[i - existing] || `视频版本 ${i + 1}：保持“${plan.hookStrategy}”和基础脚本结构，只在${plan.allowedChanges.map(key => VERSION_CHANGES[key]).join('、')}范围内形成不同的执行表达。不得改变创意方向和权益承诺。`).slice(0, 2000),
      versionPlan: structuredClone(plan),
      concepts: [structuredClone(concept)], selectedConceptId: concept.id, storyboard: null, phase: 4,
      review: { mode: 'automatic', status: 'idle', approved: false, requirements: parent.review?.requirements || [], checklist: {}, notes: '' },
      render: { model: parent.render?.model || '', params: parent.render?.params || {}, voicePreset: parent.render?.voicePreset, shots: {}, finalVideo: null, cover: null },
      variants: [], createdAt: new Date().toISOString(),
    }
    records.push(record)
  }
  for (const item of parent.creatives || []) if (!Object.hasOwn(item, 'versionPlan')) item.versionPlan = item.storyboard ? null : structuredClone(plan)
  parent.versionPlan = plan
  parent.review = { ...parent.review, approved: false, status: 'stale' }
  parent.creativeName ||= `${plan.concept.title} · 版本 1（基础脚本）`
  parent.creatives = [...(parent.creatives || []), ...records]
  parent.brief.deliveryCount = count
  return parent
}

// Serial work deliberately bounds provider concurrency. Failed/blocked items do
// not abort their siblings; a retry resumes existing remote jobs and media.
export async function runCreativePipeline(id, stage, { load, invoke, progress, cancelled, wait }) {
  const step = async (name, body) => { if (cancelled()) throw failure('已暂停，已完成的内容保留', 409); await progress(name); return invoke(id, name, body || {}) }
  let p = await load(id)
  assertStoryboardCurrent(p)
  if (stage !== 'storyboard' && !p.storyboard?.shots?.length) throw failure('请先在分镜规划中准备此版本的脚本', 422)
  if (stage !== 'storyboard' && p.storyboard?.source?.startsWith('mock')) throw failure('当前仍是示例脚本，请先在分镜规划中重新生成或确认真实脚本', 422)
  if (stage === 'produce' && !p.review?.approved) throw failure('自动审核未通过，请先在自动审核阶段完成品牌、平台与创意一致性检查', 422)
  if (!p.storyboard?.shots?.length || p.storyboard.source?.startsWith('mock')) {
    const result = await step('storyboard', { userPreference: p.creativeInstruction || '' })
    if (!['gemini', 'llm'].includes(result.source)) throw failure('模型未完成真实分镜生成，已保留示例供查看；请检查模型后单条重新生成', 503)
    p = await load(id)
  }
  if (stage === 'storyboard') return '分镜已就绪'
  if (!p.review?.approved) { await step('review', { autoRepair: !p.experimentLink }); p = await load(id) }
  if (!p.review?.approved) throw failure('自动审核未通过，请查看该素材的规则与修复建议', 422)
  if (stage === 'review') return '自动审核通过'
  for (const shot of p.storyboard.shots) {
    p = await load(id)
    let render = p.render.shots[shot.id]
    if (render?.url && !render.stale) continue
    if (render?.status !== 'running') {
      await step('render', { shotId: shot.id }); p = await load(id); render = p.render.shots[shot.id]
    }
    for (let attempts = 0; render?.status === 'running' && attempts < 80; attempts++) {
      if (cancelled()) throw failure('已暂停，远程镜头任务保留，下次继续查询进度', 409)
      await wait(15000)
      await step('poll', { shotId: shot.id }); p = await load(id); render = p.render.shots[shot.id]
    }
    if (!render?.url || render.stale) throw failure(render?.error || '镜头尚未就绪，请回传视频或稍后重试；已有远程任务会继续查询', 422)
  }
  p = await load(id)
  if (!p.render.finalVideo || p.render.finalVideo.stale) {
    const result = await step('assemble')
    if (!result.ffmpeg) throw failure('镜头已保存，需配置 FFmpeg 后继续合成', 422)
  }
  p = await load(id)
  if (p.render.qualityReview?.status !== 'passed') await step('quality')
  p = await load(id)
  if (p.render.qualityReview?.status !== 'passed') throw failure('成片已保存，质检发现问题或待补充，请展开该素材查看', 422)
  return '成片与质检已完成'
}
