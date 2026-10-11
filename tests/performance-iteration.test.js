import test from 'node:test'
import assert from 'node:assert/strict'
import { createMaterialTest } from '../src/server/material-tests.js'
import { experimentReport, normalizeObservations, mergeObservations, assertExperimentLock } from '../src/server/experiments.js'
import { createPerformanceIteration } from '../src/server/performance-iteration.js'
import { creativeRecord } from '../src/server/batch.js'

function fixture(){
  const base={id:'base',name:'测试母版',brief:{audience:'通勤人群'},assets:{},facts:[],concepts:[],selectedConceptId:null,review:{approved:true},variants:[],storyboard:{globalContext:{},shots:[{id:'hook',index:1,durationSec:3,vo:'原开头',actionCn:'通勤画面'},{id:'cta',index:2,durationSec:3,vo:'去叫车'}]},render:{model:'manual',params:{},shots:{hook:{url:'/media/hook.mp4',backend:'manual'},cta:{url:'/media/cta.mp4',backend:'manual'}},finalVideo:{url:'/media/a.mp4'},cover:null}}
  const experiment=createMaterialTest(base,[base],{mode:'tracking',primaryMetric:'ctr',hypothesis:'寻找修改方向'})
  const row={version:base.id,startDate:'2026-10-01',endDate:'2026-10-07',impressions:'10000',clicks:'300',conversions:'30',spend:'300',revenue:'1200',adCreativeId:'AD-A',source:'隔离测试数据'}
  experiment.observations=normalizeObservations([row],experiment,[base])
  return{base,experiment,row}
}
test('tracking supports one material and associates optional advertising ID and revenue without inventing missing values',()=>{
  const {base,experiment,row}=fixture()
  let report=experimentReport(experiment,[base])
  assert.equal(report.versions[0].metrics.roas,4);assert.deepEqual(report.versions[0].adCreativeIds,['AD-A'])
  const later=normalizeObservations([{...row,startDate:'2026-10-08',endDate:'2026-10-09',revenue:''}],experiment,[base])
  experiment.observations=mergeObservations(experiment.observations,later)
  report=experimentReport(experiment,[base]);assert.equal(report.versions[0].metrics.roas,null)
  assert.throws(()=>normalizeObservations([{...row,revenue:'-1'}],experiment,[base]),/成交金额/)
})
test('insights remain observational with small samples, differing periods, or changed video',()=>{
  const {base,experiment,row}=fixture()
  experiment.observations=normalizeObservations([{...row,clicks:'10',conversions:'1'}],experiment,[base])
  assert.match(experimentReport(experiment,[base]).insights[0].title,/样本较少/)
  base.render.finalVideo.url='/media/updated.mp4'
  assert.equal(experimentReport(experiment,[base]).insights[0].status,'stale')
})
test('click growth with conversion decline suggests a hypothesis without claiming causality',()=>{
  const {base,row}=fixture(),other=structuredClone(base);other.id='other';other.render.finalVideo.url='/media/b.mp4'
  const e=createMaterialTest(base,[base,other],{mode:'comparison',primaryMetric:'ctr',hypothesis:'对比表现'})
  e.observations=normalizeObservations([row,{...row,version:'other',clicks:'600',conversions:'30'}],e,[base,other])
  let report=experimentReport(e,[base,other]);assert.equal(report.insights[1].variable,'cta');assert.match(report.insights[1].evidence,/不能归因/)
  e.observations[1].endDate='2026-10-08';report=experimentReport(e,[base,other]);assert.match(report.insights[1].title,/可比版本/)
})
test('performance iteration preserves parent evidence and fixed clips while clearing only the changed clip and old approval',()=>{
  const {base,experiment}=fixture(),before=structuredClone(base)
  const created=createPerformanceIteration(base,experiment,[base],{projectId:base.id,variable:'hook',instruction:'只验证新开头',changes:{vo:'新的开头',durationSec:99}})
  assert.deepEqual(base,before);assert.equal(created.project.batchId,base.id)
  assert.equal(created.project.render.shots.hook,undefined);assert.equal(created.project.render.shots.cta.url,base.render.shots.cta.url)
  assert.equal(created.project.render.finalVideo,null);assert.equal(created.project.storyboard.shots[0].durationSec,3)
  assert.equal(created.project.iteration.evidence.metrics.ctr,.03)
  assert.equal(creativeRecord(created.project).iteration.parentProjectId,base.id)
  assert.doesNotThrow(()=>assertExperimentLock(created.project))
  assert.equal(created.experiment.versions[1].parentProjectId,base.id)
  assert.equal(experimentReport(experiment,[base,created.project]).iterations.length,1)
})
test('iteration rejects stale, missing, unchanged, and unrelated materials before creating a version',()=>{
  const {base,experiment}=fixture(),input={projectId:base.id,variable:'cta',instruction:'验证结尾',changes:{vo:'新的结尾'}}
  assert.throws(()=>createPerformanceIteration(base,experiment,[base],{...input,projectId:'foreign'}),/当前成片/)
  assert.throws(()=>createPerformanceIteration(base,experiment,[base],{...input,changes:{vo:'去叫车'}}),/至少改变/)
  base.render.shots.cta.stale=true
  assert.throws(()=>createPerformanceIteration(base,experiment,[base],input),/当前成片/)
})
