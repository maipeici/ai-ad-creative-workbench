import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

async function loadTs(path){
  const source=await readFile(new URL(path,import.meta.url),'utf8')
  const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}})
  return import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'))
}
const {createIterationDemo,appendDemoIteration}=await loadTs('../src/client/demo/iteration-demo.ts')
const {performanceRows}=await loadTs('../src/client/lib/performance-rows.ts')
const template={id:'real-project',name:'真实项目',brief:{audience:'真实人群'},storyboard:{shots:[{id:'real-shot'}]},render:{finalVideo:{url:'/real.mp4'}},iteration:{parentProjectId:'real-parent'},experiments:[{id:'real-record'}]}

test('demo is isolated from real data and labels every metric source as synthetic',()=>{
  const before=structuredClone(template),demo=createIterationDemo(template)
  assert.equal(demo.report.versions.length,5)
  for(const v of demo.report.versions){
    assert.match(v.projectId,/^demo-/);assert.equal(v.source,'demo')
    assert.match(v.sources[0],/虚构演示数据/);assert.equal(v.videoUrl,undefined)
    assert.equal(v.metrics.ctr,v.totals.clicks/v.totals.impressions)
    assert.equal(v.metrics.cpa,v.totals.spend/v.totals.conversions)
    assert.equal(v.metrics.roas,v.totals.revenue/v.totals.spend)
    assert.equal(demo.projects[v.projectId].render.finalVideo,null)
    assert.deepEqual(demo.projects[v.projectId].experiments,[])
  }
  demo.projects['demo-a'].brief.audience='演示改动'
  assert.deepEqual(template,before)
})

test('demo remix changes one shot only, preserves parent, and never inherits performance',()=>{
  for(const variable of ['hook','cta']){
    const state=createIterationDemo(template),before=structuredClone(state),base=state.projects['demo-a2']
    const index=variable==='cta'?3:0
    const next=appendDemoIteration(state,base.id,variable,'验证一处改动',{actionCn:'新画面',vo:'新口播',subtitle:'新字幕'})
    assert.deepEqual(state,before)
    const child=next.projects['demo-revision-R1']
    assert.equal(child.iteration.parentProjectId,base.id)
    assert.equal(child.storyboard.shots[index].vo,'新口播')
    for(let i=0;i<4;i++)if(i!==index)assert.deepEqual(child.storyboard.shots[i],base.storyboard.shots[i])
    assert.equal(child.storyboard.shots[index].durationSec,base.storyboard.shots[index].durationSec)
    const row=next.report.versions.at(-1)
    assert.equal(row.hasData,false);assert.equal(row.metrics.cpa,null);assert.equal(row.totals.spend,0)
    assert.equal(row.parentProjectId,base.id);assert.deepEqual(row.adCreativeIds,[])
    assert.deepEqual(createIterationDemo(template),before)
  }
})

test('source table includes a child before data and uses only its linked report afterward',()=>{
  const demo=createIterationDemo(template),source=demo.report
  source.iterations=[{projectId:'child',name:'新版',parentProjectId:'demo-a',changeSummary:'仅改开头',experimentId:'linked'}]
  let rows=performanceRows(source,[])
  assert.equal(rows.length,6);assert.equal(rows.at(-1).label,'R1')
  assert.equal(rows.at(-1).hasData,false);assert.equal(rows.at(-1).metrics.ctr,null)
  const actual={...source.versions[0],projectId:'child',label:'B',name:'新版',metrics:{ctr:.08,cvr:.03,cpa:20,roas:5}}
  const wrong={id:'unrelated',versions:[{...actual,metrics:{...actual.metrics,ctr:.99}}]}
  const linked={id:'linked',versions:[actual]}
  rows=performanceRows(source,[wrong,linked])
  assert.equal(rows.at(-1).metrics.ctr,.08)
  assert.equal(rows.at(-1).parentProjectId,'demo-a')
  assert.equal(source.versions.length,5)
  assert.equal(performanceRows({...source,versions:[...source.versions,actual]},[linked]).length,6)
})
