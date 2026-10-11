import { createHash } from 'node:crypto'
import { usableFact } from './workspace.js'

export const DEFAULT_REVIEW_REQUIREMENTS = [
  '创意匹配目标人群与出行场景',
  '开头钩子在前 3 秒内清晰呈现',
  '核心卖点突出，且引用已确认的产品事实',
  '优惠金额、门槛、城市、人群和有效期与活动依据一致',
  '人物、车辆和场景的分镜描述前后一致',
  '产品展示与下单路径有官方素材或已确认事实支持',
  '品牌名称、Logo 使用方案与品牌色符合品牌规范',
  '竖屏构图和字幕排版方案遵守渠道安全区',
  '口播和字幕可在目标时长内清楚表达',
  'CTA 明确具体，且不包含无依据的权益承诺',
  '文案通过合规扫描，不含极限词或绝对化承诺',
]

export function normalizeRequirements(value = DEFAULT_REVIEW_REQUIREMENTS) {
  if (!Array.isArray(value) || !value.length || value.length > 30 ||
      value.some(item => typeof item !== 'string' || !item.trim() || item.length > 300)) {
    const error = new Error('请提供 1–30 条审核要求，每条不超过 300 字。')
    error.status = 400
    throw error
  }
  return [...new Set(value.map(item => item.trim()))]
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  }
  return value
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

export function reviewProjectFingerprint(project) {
  const storyboard = project.storyboard && {
    ...project.storyboard,
    shots: project.storyboard.shots.map(({ preview, approved, ...shot }) => shot),
  }
  return hash({
    brandGuideId: project.brandGuideId, assets: project.assets, facts: project.facts,
    brief: project.brief, concept: project.concepts?.find(c => c.id === project.selectedConceptId),
    storyboard, versionPlan: project.versionPlan, requirements: project.review?.requirements || DEFAULT_REVIEW_REQUIREMENTS,
  })
}

export function reviewInputFingerprint(ctx) {
  const facts = new Set(ctx.project.facts || [])
  const assets = new Set(Object.values(ctx.project.assets || {}).flat())
  for (const shot of ctx.project.storyboard?.shots || []) {
    for (const id of shot.factRefs || []) facts.add(id)
    for (const key of ['personRefs', 'vehicleRefs', 'sceneRefs', 'uiRefs']) for (const id of shot[key] || []) assets.add(id)
  }
  return hash({
    project: reviewProjectFingerprint(ctx.project),
    brandGuide: ctx.brandGuide, compliance: ctx.compliance,
    facts: ctx.factLib.facts.filter(f => facts.has(f.id)).map(f => ({ ...f, currentlyUsable: usableFact(f) })),
    assets: ctx.assetLib.items.filter(a => assets.has(a.id)), channel: ctx.channel,
    policy: ctx.reviewPolicy,
  })
}

export function invalidateReview(project) {
  if (project.review) {
    project.review = {
      ...project.review, approved: false, approvedAt: null,
      status: project.review.checkedAt ? 'stale' : 'idle',
    }
  }
  return project
}

export function refreshReview(ctx) {
  const review = ctx.project.review
  if (review?.approved && (review.mode !== 'automatic' || review.fingerprint !== reviewInputFingerprint(ctx))) {
    invalidateReview(ctx.project)
  } else if (review?.checkedAt && review.fingerprint !== reviewInputFingerprint(ctx)) {
    invalidateReview(ctx.project)
  }
  if (ctx.project.render?.qualityReview && ctx.project.render.qualityReview.contextFingerprint !== reviewInputFingerprint(ctx)) ctx.project.render.qualityReview.status = 'stale'
  return ctx.project
}
