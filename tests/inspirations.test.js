import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { normalizeReference, metric, parseImport, recommendReferences, createReferenceStore, referenceFingerprint, analyzeReference, reuseReference, DEMO_REFERENCES } from '../src/server/inspirations.js'

const today=new Date().toISOString().slice(0,10)
const reference=(extra={})=>normalizeReference({title:'下班出行参考',platform:'douyin',industry:'mobility',sourceUrl:'https://www.douyin.com/video/1234567890',script:'下班后大家离开写字楼。打开手机查看出行方案，然后发起叫车，车辆到达后核对车牌上车。',tags:'下班 通勤',...extra})
const ctx={project:{brief:{channel:'oceanengine-douyin',durationSec:15,audience:'commuter',scene:'evening',tone:'relatable',sellingPoint:'一键发起叫车'},concepts:[{id:'original'}],selectedConceptId:'original'},facts:{confirmed:[{id:'fact-one',title:'一键叫车',statement:'可一键发起叫车'}],unusable:[]},brandGuide:{brandIdentity:{productName:'品牌甲',category:'出行服务'},audienceOptions:[{id:'commuter',name:'通勤人群',painPoints:[]}],sceneOptions:[{id:'evening',name:'下班返程'}],adStructures:[],format:{}},channel:{name:'抖音'},picked:{},assetLib:{categories:[]},compliance:{rules:[{id:'absolute',name:'绝对承诺',severity:'block',terms:['保证立即到达']}]}}
const analysisData={summary:'从下班场景自然过渡到叫车操作。',segments:[{timing:'时间未提供',role:'产品呈现',evidence:'打开手机查看出行方案',explanation:'在出行场景中呈现产品步骤。'}],suggestions:[{id:'hook',label:'下班场景开场',pattern:'场景痛点先行',adaptation:'以目标人群的下班场景开场。',caution:'不照搬原品牌和优惠。',testHypothesis:'仅改变开场，比较观看表现。'}],limitations:'仅基于导入脚本，未观看原片。'}
const conceptData={title:'下班的出行选择',coreIdea:'结合下班场景展示一键叫车。',audienceFit:'通勤人群',hook:'下班后走出写字楼',painPoint:'规划下班出行',sellingPoint:'一键发起叫车',factRefs:['fact-one'],productAppearance:'后期使用官方界面素材',ctaText:'打开应用叫车',beats:[{role:'hook',name:'下班',description:'走出写字楼'},{role:'product',name:'操作',description:'展示已确认功能'},{role:'cta',name:'行动',description:'明确叫车动作'}]}

test('reference validation preserves zero versus missing values, validates provenance and dates',()=>{
  const r=reference({likes:'0',views:'1.2万',observedAt:today,sourceNote:'公开计数手动记录'})
  assert.equal(r.metrics.likes,0);assert.equal(r.metrics.views,12000);assert.equal(r.metrics.saves,null)
  assert.throws(()=>reference({likes:1,observedAt:today}),/来源/)
  assert.throws(()=>reference({likes:1,sourceNote:'公开页面'}),/统计日期/)
  assert.throws(()=>reference({publishedAt:'2026-02-31'}),/日期/)
  assert.throws(()=>reference({publishedAt:'not-a-date'}),/日期/)
  assert.throws(()=>reference({sourceUrl:'javascript:alert(1)'}),/HTTPS/)
  assert.throws(()=>reference({sourceUrl:'https://user:secret@example.com'}),/HTTPS/)
  assert.throws(()=>reference({platform:'made-up'}),/平台/)
  assert.throws(()=>metric(-2,'likes'),/非负/)
  assert.throws(()=>metric(101,'ctr',true),/范围/)
  assert.throws(()=>reference({ctr:1,sourceNote:'后台',observedAt:today}),/仅适用/)
})
test('CSV accepts quoted multiline scripts and rejects invalid batches atomically',()=>{
  const rows=parseImport('\uFEFFtitle,platform,industry,script,isDemo\r\n"参考,甲",douyin,mobility,"一句台词\n另一个镜头",true\r\n','csv')
  assert.equal(rows.length,1);assert.equal(rows[0].title,'参考,甲');assert.equal(rows[0].script,'一句台词\n另一个镜头');assert.equal(rows[0].isDemo,true)
  assert.throws(()=>parseImport('title,__proto__\n甲,attack','csv'),/列名/)
  assert.throws(()=>parseImport('title,platform\n"unclosed','csv'),/闭合/)
  assert.throws(()=>parseImport(JSON.stringify([{title:'合格',platform:'douyin',industry:'mobility'},{title:'缺少平台'}]),'json'),/第 2 条/)
})
test('recommendations keep platform and industry constraints, missing dates do not enter recent filter',()=>{
  const a=reference({publishedAt:today,likes:500,observedAt:today,sourceNote:'页面记录'})
  const b=reference({platform:'xiaohongshu',likes:999999,observedAt:today,sourceNote:'页面记录'})
  const c=reference({industry:'beauty'}),d=reference({title:'没有日期'})
  const ranked=recommendReferences([a,b,c,d],{platform:'douyin',industry:'mobility',days:'30'},ctx)
  assert.deepEqual(ranked.map(r=>r.id),[a.id]);assert.ok(ranked[0].reasons.some(r=>r.includes('样本较少')))
  assert.equal(recommendReferences([d],{},ctx)[0].engagement,null)
  assert.ok(DEMO_REFERENCES.every(r=>r.isDemo&&!r.sourceUrl&&Object.values(r.metrics).every(v=>v===null)))
})
test('store survives reloads, deduplicates source links and serializes concurrent imports',async()=>{
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'inspiration-test-'))
  try{const store=createReferenceStore(base),a=reference();await store.import([a]);await store.import([reference({title:'更新后的标题'})]);assert.equal((await store.read()).length,1);assert.equal((await store.read())[0].id,a.id)
    await Promise.all([store.import([reference({sourceUrl:'',title:'第二条'})]),store.import([reference({sourceUrl:'',title:'第三条'})])])
    const reopened=createReferenceStore(base);assert.equal((await reopened.read()).length,3)
    await store.update(a.id,{archived:true});assert.equal(recommendReferences(await store.read()).length,2)
    await store.import([reference({sourceUrl:'https://mp.weixin.qq.com/s?mid=1&idx=1'}),reference({sourceUrl:'https://mp.weixin.qq.com/s?mid=2&idx=1'})])
    assert.equal((await store.read()).length,5,'different query-based video IDs must remain separate')
  }finally{assert.ok(path.resolve(base).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(base).startsWith('inspiration-test-'));await fs.rm(base,{recursive:true,force:true})}
})
test('analysis refuses link-only references and unavailable models',async()=>{
  await assert.rejects(analyzeReference(ctx,reference({script:''}),async()=>{throw new Error('Should not call model')}),/至少 20 字/)
  await assert.rejects(analyzeReference(ctx,reference(),async()=>({source:'mock',data:analysisData})),e=>e.status===503)
  const r=reference(),result=await analyzeReference(ctx,r,async messages=>{assert.match(messages[0].content,/待分析数据/);return {source:'gemini',data:analysisData}})
  assert.equal(result.fingerprint,referenceFingerprint(ctx,r));assert.equal(result.segments[0].timing,'时间未提供')
  await assert.rejects(analyzeReference(ctx,r,async()=>({source:'gemini',data:{...analysisData,segments:[{...analysisData.segments[0],evidence:'模型编造的原文'}]}})),e=>e.status===502)
})
test('reuse preserves source and target duration, requires selected suggestions and confirmed facts',async()=>{
  const r=reference(),analysis=await analyzeReference(ctx,r,async()=>({source:'gemini',data:analysisData}))
  const original=JSON.stringify(ctx)
  const concept=await reuseReference(ctx,r,analysis,['hook'],async messages=>{const payload=JSON.parse(messages.at(-1).content);assert.equal(payload.selectedSuggestions.length,1);assert.equal(payload.selectedSuggestions[0].id,'hook');return {source:'gemini',data:{concepts:[conceptData]}}})
  assert.equal(JSON.stringify(ctx),original);assert.equal(concept.inspiration.referenceId,r.id);assert.equal(concept.inspiration.sourceUrl,r.sourceUrl);assert.equal(concept.beats.reduce((s,b)=>s+b.approxSec,0),15)
  await assert.rejects(reuseReference(ctx,r,analysis,[],async()=>null),/至少选择/)
  await assert.rejects(reuseReference(ctx,r,analysis,['cta'],async()=>null),/有效/)
  await assert.rejects(reuseReference(ctx,r,analysis,['hook'],async()=>({source:'mock-fallback'})),e=>e.status===503)
  await assert.rejects(reuseReference(ctx,r,analysis,['hook'],async()=>({source:'gemini',data:{concepts:[{...conceptData,factRefs:['competitor-coupon']} ]}})),e=>e.status===422)
  const changed={...ctx,project:{...ctx.project,brief:{...ctx.project.brief,durationSec:20}}}
  await assert.rejects(reuseReference(changed,r,analysis,['hook'],async()=>null),e=>e.status===409)
})

test('reused concepts preserve model pacing and scan every beat for compliance',async()=>{
  const r=reference(),analysis=await analyzeReference(ctx,r,async()=>({source:'gemini',data:analysisData}))
  const timed={...conceptData,beats:conceptData.beats.map((b,i)=>({...b,approxSec:[3,8,4][i],description:i===1?'保证立即到达':b.description}))}
  const concept=await reuseReference(ctx,r,analysis,['hook'],async()=>({source:'gemini',data:{concepts:[timed]}}))
  assert.deepEqual(concept.beats.map(b=>b.approxSec),[3,8,4])
  assert.ok(concept.complianceHits.some(h=>h.term==='保证立即到达'))
})

test('a coupon CTA cannot enter a reused concept with only a product feature fact',async()=>{
  const c={...ctx,project:{...ctx.project,brief:{...ctx.project.brief,cta:'download-claim'}},compliance:{...ctx.compliance,requireFactBinding:{campaignOnlyPatterns:['领券','新人券']}}}
  const r=reference(),analysis=await analyzeReference(c,r,async()=>({source:'gemini',data:analysisData}))
  await assert.rejects(reuseReference(c,r,analysis,['hook'],async messages=>{
    assert.match(messages[1].content,/CTA: 下载应用，体验已确认产品功能/)
    return {source:'gemini',data:{concepts:[{...conceptData,ctaText:'点击下载，领取新人券'}]}}
  }),e=>e.status===422)
  assert.equal(c.project.brief.cta,'download-claim','generation must not silently change the saved brief')
})
