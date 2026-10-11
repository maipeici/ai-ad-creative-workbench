import { randomUUID } from 'node:crypto'
import { failure } from './experiments.js'
import { assertStoryboardCurrent } from './inspiration-guidance.js'

// The original project's video remains in place. Additional creatives are nested
// records, projected through the existing single-video endpoints for compatibility.
export const CREATIVE_FIELDS = ['creativeName', 'creativeInstruction', 'sharedSnapshot', 'phase', 'concepts', 'selectedConceptId', 'storyboard', 'review', 'render', 'variants', 'experimentLink', 'createdAt', 'updatedAt']
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
    conceptId: project.selectedConceptId, instruction: project.creativeInstruction || '', phase: project.phase,
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
  if (parent.batchId || parent.experimentLink) throw failure('请在项目的广告创意阶段添加素材')
  const ids = [...new Set(input.conceptIds || [])]
  const count = Number(input.versionsPerConcept)
  if (!ids.length || ids.some(id => !parent.concepts?.some(c => c.id === id)) || !Number.isInteger(count) || count < 1 || count > 12) throw failure('请选择有效创意，每个方向支持 1–12 个版本')
  const existing = (parent.creatives?.length || 0) + 1
  const reuseFirst = !parent.storyboard && !(parent.creatives?.length) && !parent.render?.finalVideo
  if (existing + ids.length * count - Number(reuseFirst) > 60) throw failure('每个项目最多 60 条素材，请减少本次数量')
  const instructions = Array.isArray(input.instructions) ? input.instructions : []
  const approaches = ['先展示具体出行困境，再引出解决办法', '第一人称分享出行经历，语气自然', '用一个与目标人群有关的问题开场', '用出行前后的状态变化形成对照', '用两人简短对话推进卖点', '先给出生活场景，再解释使用方法', '从用户犹豫点切入，给出有依据的回应', '用行动和细节带出产品，减少口播', '以时间线串联一次完整出行', '以场景小反转形成记忆点', '突出官方界面的操作演示', '用简洁清晰的利益点组织叙事']
  const records = []
  for (const id of ids) for (let i = 0; i < count; i++) {
    const concept = parent.concepts.find(c => c.id === id)
    const record = {
      id: randomUUID(), creativeName: `${concept.title} · 版本 ${i + 1}`,
      creativeInstruction: String(instructions[i] || `第 ${i + 1} 个创意版本：${approaches[i]}。保留已选创意方向，遵守已确认事实，不新增权益承诺。`).slice(0, 2000),
      concepts: [structuredClone(concept)], selectedConceptId: id, storyboard: null, phase: 4,
      review: { mode: 'automatic', status: 'idle', approved: false, requirements: parent.review?.requirements || [], checklist: {}, notes: '' },
      render: { model: parent.render?.model || '', params: parent.render?.params || {}, voicePreset: parent.render?.voicePreset, shots: {}, finalVideo: null, cover: null },
      variants: [], createdAt: new Date().toISOString(),
    }
    records.push(record)
  }
  if (reuseFirst) {
    const first = records.shift()
    const { id, concepts, ...fields } = first
    Object.assign(parent, fields)
  }
  parent.creatives = [...(parent.creatives || []), ...records]
  return parent
}

// Serial work deliberately bounds provider concurrency. Failed/blocked items do
// not abort their siblings; a retry resumes existing remote jobs and media.
export async function runCreativePipeline(id, stage, { load, invoke, progress, cancelled, wait }) {
  const step = async (name, body) => { if (cancelled()) throw failure('已暂停，已完成的内容保留', 409); await progress(name); return invoke(id, name, body || {}) }
  let p = await load(id)
  assertStoryboardCurrent(p)
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
