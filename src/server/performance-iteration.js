import { createMaterialTest } from './material-tests.js'
import { createExperimentVersion, experimentReport, failure } from './experiments.js'
import { assertStoryboardCurrent } from './inspiration-guidance.js'

export function createPerformanceIteration(parent, experiment, projects, input) {
  const report=experimentReport(experiment,projects)
  const evidence=report.versions.find(v=>v.projectId===input.projectId)
  const baseline=projects.find(p=>p.id===input.projectId)
  if(!evidence?.hasData || evidence.staleData || evidence.staleVideo || !baseline) throw failure('请先导入母版当前成片的投放数据，再建立迭代版本',409)
  assertStoryboardCurrent(baseline)
  if(baseline.storyboard.shots.some(s=>!baseline.render.shots[s.id]?.url||baseline.render.shots[s.id]?.stale)) throw failure('母版镜头不完整，请先完成制作',409)
  if(!['hook','cta'].includes(input.variable))throw failure('请选择仅修改开头或结尾行动引导')
  if(!input.changes||typeof input.changes!=='object'||Array.isArray(input.changes))throw failure('请填写本轮要修改的镜头内容')
  const instruction=String(input.instruction||'').trim()
  if(!instruction||instruction.length>2000)throw failure('请填写 1–2000 字的迭代假设')
  const changeSummary=input.variable==='hook'?'仅改开头':'仅改结尾 CTA'
  const next=createMaterialTest(parent,[baseline],{mode:'single-variable',variable:input.variable,primaryMetric:experiment.primaryMetric,hypothesis:instruction,title:`${baseline.creativeName||evidence.name} · ${changeSummary}`, ...experiment.plan})
  next.sourceExperimentId=experiment.id
  const copied=structuredClone(baseline)
  copied.experimentLink={parentId:parent.id}
  const created=createExperimentVersion(copied,next,input.changes)
  const project=created.project
  project.batchId=parent.id
  project.creativeName=`${evidence.name} · ${changeSummary}`.slice(0,100)
  project.creativeInstruction=instruction
  project.sharedSnapshot=Object.fromEntries(['assets','facts','brief','brandGuideId'].map(k=>[k,structuredClone(baseline[k])]))
  project.iteration={parentProjectId:baseline.id,sourceExperimentId:experiment.id,variable:input.variable,changeSummary,instruction,evidence:{totals:evidence.totals,metrics:evidence.metrics,periods:evidence.periods,videoUrl:evidence.videoUrl},createdAt:new Date().toISOString()}
  for(const key of ['creatives','batch','batchJob','experiments'])delete project[key]
  created.version.parentProjectId=baseline.id
  created.version.changeSummary=changeSummary
  next.versions.push(created.version)
  return {project,experiment:next}
}
