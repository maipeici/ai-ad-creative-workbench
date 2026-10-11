import { validateStoryboard } from './validate.js'
import { assertStoryboardCurrent } from './inspiration-guidance.js'
import { failure } from './experiments.js'

// Local checks only: production does not require a model's script approval.
export function productionPreflight(ctx) {
  assertStoryboardCurrent(ctx.project)
  if (!ctx.project.storyboard?.shots?.length) throw failure('请先在分镜规划中准备脚本', 422)
  const validation = validateStoryboard(ctx)
  const blockers = [...validation.global, ...validation.shots.flatMap(s => s.issues.map(issue => ({ ...issue, reason: `镜头 #${s.index}：${issue.reason}` })))].filter(i => i.severity === 'block')
  if (blockers.length) throw Object.assign(failure(`生成前基础检查发现 ${blockers.length} 项问题：${blockers.map(i => i.reason).join('；')}`, 422), { blockers })
  return validation
}
