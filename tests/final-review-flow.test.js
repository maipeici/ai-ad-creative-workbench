import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeQuality, isFinalVideoApproved, qualityFingerprint, assertDeliverable } from '../src/server/delivery.js'
import { runCreativePipeline } from '../src/server/batch.js'
import { registerBatchRoutes } from '../src/server/batch-routes.js'
import { refreshReview, reviewInputFingerprint } from '../src/server/review-state.js'

function film(id='base') {
  return {id,name:id,brief:{},assets:{},facts:[],concepts:[],storyboard:{shots:[{id:'shot',index:1,durationSec:3}]},review:{approved:false},render:{shots:{shot:{url:'/media/clip.mp4'}},finalVideo:{url:'/media/'+id+'.mp4'}}}
}
const mediaChecks=['visual','text','audio','facts','delivery']
function approve(p,rules=[]) {
  p.render.qualityReview=normalizeQuality({source:'gemini',data:{checks:[...mediaChecks,...rules.map(r=>'policy-'+r.id)].map(id=>({id,status:'pass',evidence:'实际视频有对应画面及声音依据',timing:'0–3 秒'}))}},p,{rules})
  return p
}
test('final review checks completed video without any script review or production call',async()=>{
  const p=film(),calls=[]
  await runCreativePipeline(p.id,'review',{load:async()=>p,progress:async()=>{},cancelled:()=>false,invoke:async(_,action)=>{calls.push(action);approve(p)}})
  assert.deepEqual(calls,['quality']);assert.equal(isFinalVideoApproved(p),true)
  p.render.finalVideo=null
  await assert.rejects(runCreativePipeline(p.id,'review',{load:async()=>p,invoke:()=>assert.fail('must not submit')}),/完整视频/)
})
test('script approval and partial/old reviews cannot authorize a package; changed video invalidates approval',()=>{
  const p=film();p.review.approved=true
  assert.throws(()=>assertDeliverable(p),e=>e.status===409)
  approve(p);assert.doesNotThrow(()=>assertDeliverable(p))
  p.render.finalVideo.url='/media/replaced.mp4';assert.equal(isFinalVideoApproved(p),false)
  approve(p);p.render.shots.shot.stale=true;assert.equal(isFinalVideoApproved(p),false)
  delete p.render.shots.shot.stale;delete p.render.qualityReview.reviewVersion;assert.equal(isFinalVideoApproved(p),false)
})
test('one final review includes brand, platform, creative consistency and project extras',()=>{
  const rules=[{id:'brand',group:'brand'},{id:'platform',group:'platform'},{id:'creative',group:'production'},{id:'extra',group:'extra'}].map(r=>({...r,label:r.id,source:r.group}))
  const p=approve(film(),rules)
  assert.equal(p.render.qualityReview.results.length,9)
  assert.equal(isFinalVideoApproved(p),true)
  const partial=normalizeQuality({source:'gemini',data:{checks:p.render.qualityReview.results.slice(0,7)}},p,{rules})
  assert.equal(partial.status,'needs-input')
  rules[1].requiredInput=true
  assert.equal(approve(film(),rules).render.qualityReview.status,'needs-input')
})
test('brand or policy changes invalidate the approved final video',()=>{
  const project=approve(film()),ctx={project,brandGuide:{},compliance:{},factLib:{facts:[]},assetLib:{items:[]},reviewPolicy:{rules:[]}}
  project.render.qualityReview.contextFingerprint=reviewInputFingerprint(ctx)
  refreshReview(ctx);assert.equal(isFinalVideoApproved(project),true)
  ctx.reviewPolicy.rules.push({id:'new',label:'新增审核要求'})
  refreshReview(ctx);assert.equal(isFinalVideoApproved(project),false)
})
test('batch ZIP includes only approved current films and rejects explicitly selected unapproved videos',async()=>{
  const passed=approve(film()),pending=film('pending'),stale=approve(film('stale'));stale.render.finalVideo.stale=true
  const parent={...passed,creatives:[pending,stale]},projects=new Map([[parent.id,parent],[pending.id,pending],[stale.id,stale]])
  const handlers=new Map(),packaged=[]
  const app={use(){},post(){},get(url,handler){handlers.set(url,handler)}}
  registerBatchRoutes(app,{wrap:f=>f,readProject:async()=>parent,loadContext:async id=>({project:projects.get(id)}),packageFiles:async p=>{packaged.push(p.id);return [{name:p.id+'.mp4',bytes:'video'}]}})
  const call=async ids=>{let bytes;await handlers.get('/api/projects/:id/batch/delivery.zip')({params:{id:parent.id},query:ids?{ids}:{}},{set(){return this},type(){return this},send(value){bytes=value}});return bytes}
  const bytes=await call();assert.deepEqual(packaged,['base']);assert.equal(bytes.readUInt32LE(0),0x04034b50);assert.ok(bytes.includes(Buffer.from('batch-manifest.json')))
  await assert.rejects(call('pending'),e=>e.status===409)
  await assert.rejects(call('stale'),e=>e.status===409)
  await assert.rejects(call('missing'),/有效素材/)
  assert.equal(parent.render.qualityReview.inputFingerprint,qualityFingerprint(parent))
})
