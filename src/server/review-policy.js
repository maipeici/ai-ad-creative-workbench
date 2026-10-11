import fs from 'node:fs/promises'
import path from 'node:path'
import { BUSINESS_DIR } from './config.js'
import { DEFAULT_REVIEW_REQUIREMENTS } from './review-state.js'
import { getWorkspace } from './workspace.js'

export async function getPlatformPolicies() {
  const library = JSON.parse(await fs.readFile(path.join(BUSINESS_DIR, 'platform-policies.json'), 'utf8'))
  const workspace = await getWorkspace()
  library.profiles = library.profiles.map(profile => workspace.platformPolicies?.find(p => p.id === profile.id) || profile)
  return library
}
export function additionalRequirements(values) {
  return (values || []).filter(value => !DEFAULT_REVIEW_REQUIREMENTS.includes(value))
}
export function buildReviewPolicy(ctx, library) {
  const profile = library.profiles.find(p => p.id === ctx.project.brief?.channel)
  const brand = ctx.brandGuide
  const rules = []
  for (const [group, values] of [['品牌识别', brand.brandIdentity?.logoRules], ['产品展示', brand.productDisplayRules], ['品牌文案', brand.copyRules], ['禁止事项', brand.restrictions], ['品牌补充要求', brand.reviewRules]]) {
    for (const [i, label] of (values || []).entries()) rules.push({ id: `brand-${group}-${i}`, group: 'brand', label, source: `合规边界说明 · ${group}` })
  }
  rules.push({ id: 'brand-facts', group: 'brand', label: '文案与已确认产品事实、活动条件和有效期一致；没有依据的权益不得出现。', source: '营销活动与产品事实' })
  for (const rule of profile?.rules || []) rules.push({ ...rule, group: 'platform', source: profile.name, sourceUrl: profile.sources[rule.sourceIndex]?.url })
  if (!profile?.rules.length || profile.coverage === 'missing') rules.push({ id: 'platform-missing', group: 'platform', label: profile?.missing || '所选平台尚无审核规则', source: profile?.name || '平台规则', requiredInput: true })
  rules.push({ id: 'production-feasibility', group: 'production', label: '分镜时长、口播长度、字幕排版与渠道画幅及安全区配置可执行；创意建议不作为平台硬性规定。', source: '制作规格' })
  for (const [i, label] of additionalRequirements(ctx.project.review?.requirements).entries()) rules.push({ id: `extra-${i}`, group: 'extra', label, source: '项目额外要求' })
  if (ctx.project.versionPlan) rules.push({ id: 'creative-consistency', group: 'production', label: `与基础脚本保持同一核心创意、开头钩子（${ctx.project.versionPlan.hookStrategy}）、叙事顺序、卖点和 CTA；只允许已选择的变化，英文画面提示词也必须遵守。${ctx.project.versionPlan.fixedNotes}`, source: '共用创意与版本范围' })
  return { version: library.version, scope: library.scope, platform: profile || null, rules }
}
