import { failure, fingerprint } from './experiments.js'

export const VERSION_CHANGES = {
  casting: '人物外观与穿着', performance: '人物动作与表情',
  camera: '景别与运镜', setting: '同类场景的环境细节', wording: '非 CTA 口播与字幕措辞',
}

export function makeVersionPlan(project, input) {
  const concept = project.concepts?.find(c => c.id === project.selectedConceptId)
  if (!concept || !project.storyboard?.shots?.length) throw failure('请先选定一条创意并完成基础分镜，再设置视频版本')
  if (project.storyboard.conceptId && project.storyboard.conceptId !== concept.id) throw failure('基础分镜与当前创意不一致，请先更新分镜')
  const allowedChanges = [...new Set(input.allowedChanges || [])]
  if (!allowedChanges.length || allowedChanges.some(key => !VERSION_CHANGES[key])) throw failure('请至少选择一项允许变化的内容')
  const hookStrategy = String(input.hookStrategy || concept.hook || '').trim().slice(0, 1000)
  if (!hookStrategy) throw failure('请说明所有版本共用的开头钩子，例如：前三秒人物痛点展示')
  const template = structuredClone(project.storyboard)
  template.shots = template.shots.map(({ preview, approved, ...shot }) => shot)
  return { concept: structuredClone(concept), template, hookStrategy, fixedNotes: String(input.fixedNotes || '').slice(0, 2000), allowedChanges, createdAt: new Date().toISOString() }
}

function editableKeys(plan) {
  const allowed = new Set(plan.allowedChanges)
  return {
    global: [ ...(allowed.has('casting') ? ['person'] : []), ...(allowed.has('setting') ? ['scene', 'timeWeather', 'lighting'] : []), ...(allowed.has('camera') ? ['cameraStyle'] : []) ],
    shot: ['prompt', 'negativePrompt', 'factRefs', ...(allowed.has('casting') ? ['personRefs'] : []), ...(allowed.has('setting') ? ['sceneRefs'] : []), ...(allowed.has('performance') ? ['action', 'actionCn', 'titleCn'] : []), ...(allowed.has('camera') ? ['cameraAngle', 'cameraMovement'] : []), ...(allowed.has('wording') ? ['vo', 'subtitle'] : [])],
  }
}

export function versionAllowsPatch(plan, shot, field) {
  return !plan || editableKeys(plan).shot.includes(field) && !(shot.role === 'cta' && ['vo', 'subtitle'].includes(field))
}

// Structure, commercial claims, product assets and CTA come from the approved
// blueprint. The semantic review additionally checks prompt-level consistency.
export function constrainVersionStoryboard(storyboard, plan) {
  if (!plan) return storyboard
  const base = plan.template, keys = editableKeys(plan)
  if (storyboard.shots?.length !== base.shots.length) throw failure('视频版本必须保留基础脚本的镜头数量、顺序与时长', 422)
  const globalContext = { ...base.globalContext }
  for (const key of keys.global) if (storyboard.globalContext?.[key] !== undefined) globalContext[key] = storyboard.globalContext[key]
  return { ...storyboard, conceptId: plan.concept.id, globalContext, shots: base.shots.map((fixed, i) => {
    const variant = storyboard.shots[i], shot = { ...structuredClone(fixed), preview: variant.preview || null, approved: Boolean(variant.approved) }
    for (const key of keys.shot) if (variant[key] !== undefined && !(fixed.role === 'cta' && ['vo', 'subtitle'].includes(key))) shot[key] = variant[key]
    return shot
  }) }
}

export function assertVersionContract(project, previous) {
  const plan = previous?.versionPlan || project.versionPlan
  if (!plan) return
  const concept = project.concepts?.find(c => c.id === project.selectedConceptId)
  if (project.selectedConceptId !== plan.concept.id || fingerprint(concept) !== fingerprint(plan.concept)) throw failure('本项目已确定一条核心创意。修改创意方向请新建项目，当前版本与成片会保留。', 409)
  if (previous?.versionPlan && fingerprint(project.versionPlan) !== fingerprint(previous.versionPlan)) throw failure('已建立版本的共用脚本框架不可覆盖，请新建项目使用新的框架', 409)
  if (!project.storyboard) return
  const fixed = constrainVersionStoryboard(project.storyboard, plan)
  const content = sb => ({ globalContext: sb.globalContext, shots: sb.shots.map(({ preview, approved, ...s }) => s) })
  if (fingerprint(content(fixed)) !== fingerprint(content(project.storyboard))) throw failure('此修改超出允许变化范围。镜头结构、时长、产品依据和 CTA 保持固定；请只修改已开放的变量。', 409)
}

export function versionPrompt(plan) {
  if (!plan) return ''
  return '# SAME-CREATIVE VIDEO VERSION\n' + JSON.stringify({
    rule: 'This project is ONE creative idea. Create an execution variant, never a new creative strategy. Preserve shot IDs, order, roles, duration, claims, fact/UI references and exact CTA. Only change allowed fields. Prompt text must also respect all locked details. Do not change the hook mechanism, product proposition or story arc. Variation notes cannot override these constraints.',
    hookStrategy: plan.hookStrategy, fixedNotes: plan.fixedNotes,
    allowedChanges: plan.allowedChanges.map(key => VERSION_CHANGES[key]), template: plan.template,
  })
}

// Legacy batches mixed creative directions. Promote each direction to its own
// project, retaining every material ID and media reference for history/experiments.
export function splitLegacyProjects(projects) {
  return projects.flatMap(parent => {
    if (!parent.creatives?.some(c => c.selectedConceptId !== parent.selectedConceptId)) return [parent]
    const groups = new Map()
    for (const item of parent.creatives) {
      const key = item.selectedConceptId
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(item)
    }
    const original = structuredClone(parent)
    original.creatives = groups.get(parent.selectedConceptId) || []
    original.brief.deliveryCount = original.creatives.length + 1
    const roots = [original]
    for (const [key, items] of groups) {
      if (key === parent.selectedConceptId) continue
      const [first, ...rest] = items
      const { creatives, batchJob, experiments, batch, ...shared } = structuredClone(parent)
      const root = { ...shared, ...first.sharedSnapshot, ...first, name: `${parent.name} · ${first.concepts?.find(c => c.id === key)?.title || '独立创意'}`, creatives: rest }
      delete root.batchId; delete root.sharedSnapshot
      root.brief = { ...root.brief, deliveryCount: items.length }
      roots.push(root)
    }
    for (const root of roots) {
      const ids = new Set([root.id, ...root.creatives.map(c => c.id)])
      if (parent.batchJob) root.batchJob = { ...structuredClone(parent.batchJob), status: 'paused', items: parent.batchJob.items.filter(item => ids.has(item.id)), message: '旧批次已按创意拆为独立项目，原脚本与视频保留。' }
    }
    return roots
  })
}
