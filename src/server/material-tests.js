import { failure, fingerprint, PRIMARY_METRICS, EXPERIMENT_VARIABLES } from './experiments.js'
import { randomUUID } from 'node:crypto'

function fixedSignature(p, variable) {
  const shots = p.storyboard?.shots || []
  const index = variable === 'hook' ? 0 : shots.length - 1
  return fingerprint({ brief: p.brief, brand: p.brandGuideId, assets: p.assets, facts: p.facts,
    concept: p.concepts?.find(c => c.id === p.selectedConceptId), global: p.storyboard?.globalContext,
    voice: p.render.voicePreset, shots: shots.map((shot, i) => {
      const { preview, approved, ...copy } = shot
      if (i === index) for (const key of ['titleCn', 'vo', 'subtitle', 'action', 'actionCn', 'prompt', 'negativePrompt', 'sfx', 'regeneratedAt']) delete copy[key]
      return { ...copy, fixedVideo: i === index ? null : p.render.shots[shot.id]?.url }
    }) })
}
export function assertSingleVariable(projects, variable) {
  if (!EXPERIMENT_VARIABLES[variable]) throw failure('请选择开头内容或结尾行动引导')
  if (projects.some(p => !p.storyboard?.shots.length)) throw failure('单变量测试需要完整分镜')
  const fixed = fixedSignature(projects[0], variable)
  if (projects.some(p => fixedSignature(p, variable) !== fixed)) throw failure('这些素材不满足单变量条件：需求、分镜固定项及未变化镜头的视频必须一致。可以选择多素材对比，或从基准素材创建实验版。')
  const changed = p => { const s = variable === 'hook' ? p.storyboard.shots[0] : p.storyboard.shots.at(-1); return fingerprint({ vo: s.vo, subtitle: s.subtitle, action: s.action, actionCn: s.actionCn, prompt: s.prompt, video: p.render.shots[s.id]?.url }) }
  if (projects.length > 1 && new Set(projects.map(changed)).size !== projects.length) throw failure('测试版本必须在指定镜头存在实际差异，不能重复选择相同内容')
}
export function createMaterialTest(parent, projects, input) {
  if (!['tracking', 'comparison', 'single-variable'].includes(input.mode) || !PRIMARY_METRICS[input.primaryMetric]) throw failure('请选择记录方式和主要指标')
  if (!projects.length || projects.length > 60 || projects.some(p => !p.render?.finalVideo?.url || p.render.finalVideo.stale || p.storyboard?.shots.some(s=>p.render.shots[s.id]?.stale))) throw failure('请选择 1–60 条当前成片')
  if (input.mode === 'comparison' && projects.length < 2) throw failure('多素材对比至少选择两条成片；只有一条时可先建立单变量基准')
  if (!String(input.hypothesis || '').trim()) throw failure('请填写这次想验证的问题')
  if (input.mode === 'single-variable') assertSingleVariable(projects, input.variable)
  const source = projects[0]
  const editable = input.variable === 'cta' ? source.storyboard?.shots.at(-1) : source.storyboard?.shots[0]
  return { id: randomUUID(), mode: input.mode, title: String(input.title || '素材效果对比').slice(0, 100), hypothesis: String(input.hypothesis).slice(0, 1000),
    primaryMetric: input.primaryMetric, variable: input.mode === 'single-variable' ? input.variable : 'multiple',
    editableShotId: editable?.id, editableShotIndex: editable?.index, createdAt: new Date().toISOString(),
    plan: { audience: input.audience || parent.brief.audience, budget: input.budget || '', period: input.period || '', attribution: input.attribution || '点击后 7 天', trafficMethod: input.trafficMethod || 'observational' },
    versions: projects.map((p, i) => ({ label: i < 26 ? String.fromCharCode(65 + i) : `V${i+1}`, projectId: p.id, name: p.creativeName || p.concepts?.find(c => c.id === p.selectedConceptId)?.title || '素材', source: 'existing' })), observations: [], conclusion: '', nextAction: '' }
}
