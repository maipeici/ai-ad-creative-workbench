import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import express from 'express'
import { videoMime, readReferenceVideo, createVideoUpload } from '../src/server/inspiration-video.js'
import { analyzeReference, normalizeReference, referenceFingerprint } from '../src/server/inspirations.js'
import { toGeminiPayload } from '../src/server/providers/vertex.js'
import { bindStoryboardReference, conceptFingerprint, assertStoryboardCurrent } from '../src/server/inspiration-guidance.js'
import { storyboardMessages, shotRegenMessages, compileShotRenderPrompt } from '../src/server/prompts.js'

const guidance=[{id:'hook',label:'动作开场',pattern:'先呈现动作',adaptation:'以目标品牌的通勤情景开场',caution:'不使用原品牌',testHypothesis:'验证开场完播'}]
const inspiration={title:'参考视频',guidance,segments:[{timing:'0–3秒',visual:'手部特写'}]}
const ctx={project:{brief:{durationSec:15}},brandGuide:{brandIdentity:{},format:{}},facts:{confirmed:[],unusable:[]},picked:{},assetLib:{categories:[]},compliance:{rules:[]}}
const use={suggestionIds:['hook'],sourceTiming:'0–3秒',adaptation:'用目标品牌通勤动作建立节奏',visualPrompt:'Close-up of a hand picking up a bag, quick movement followed by a pause'}

test('video-only reference reaches Gemini as video bytes and returns timed audio/visual observations',async()=>{
  const ref={...normalizeReference({title:'视频',platform:'douyin',industry:'mobility'}),video:{url:'/media/reference-test.mp4'}}
  const videoPart={inlineData:{mimeType:'video/mp4',data:'AAAA'}}
  const result=await analyzeReference(ctx,ref,async(messages,fallback,options)=>{
    assert.equal(options.videoPart,videoPart)
    assert.ok(options.responseSchema.properties.transcript)
    const payload=toGeminiPayload(messages,options)
    assert.equal(payload.contents[0].parts[0],videoPart)
    return {source:'gemini',data:{summary:'动作开场',transcript:'0–3秒：手拿起包，无口播。',segments:[{timing:'0–3秒',startSec:0,endSec:3,role:'钩子',evidence:'手拿起包',visual:'手部特写',audio:'无口播，轻微环境声',explanation:'建立出门节奏'}],highlights:[{point:'动作吸引注意',evidence:'拿包特写',mechanism:'可能让观众代入'}],suggestions:guidance,limitations:'不能推断投放效果'}}
  },videoPart)
  assert.equal(result.inputKind,'video');assert.equal(result.segments[0].startSec,0)
  assert.equal(result.fingerprint,referenceFingerprint(ctx,ref))
  await assert.rejects(analyzeReference(ctx,ref,async()=>null),/视频未能载入/)
  const textPayload=toGeminiPayload([{role:'user',content:'text only'}])
  assert.deepEqual(textPayload.contents[0].parts,[{text:'text only'}])
})

test('video reader rejects spoofed paths, changed content and invalid containers',async()=>{
  assert.throws(()=>videoMime(Buffer.from('<html>not a video</html>')),/有效/)
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'reference-video-test-'))
  try{
    const bytes=Buffer.from('0000ftypisom00000000'),url='/media/reference-aabb.mp4'
    const video={url,sha256:createHash('sha256').update(bytes).digest('hex')}
    await fs.writeFile(path.join(root,'reference-aabb.mp4'),bytes)
    assert.equal((await readReferenceVideo(video,root)).inlineData.mimeType,'video/mp4')
    await assert.rejects(readReferenceVideo({...video,url:'/media/../.env'},root),/路径无效/)
    await assert.rejects(readReferenceVideo({...video,sha256:'changed'},root),e=>e.status===409)
  }finally{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(root).startsWith('reference-video-test-'));await fs.rm(root,{recursive:true,force:true})}
})

test('video observations retain source claims while target suggestions are repaired against confirmed facts',async()=>{
  const ref={...normalizeReference({title:'有优惠的原片',platform:'douyin',industry:'mobility'}),video:{url:'/media/reference-test.mp4'}}
  let calls=0
  const result=await analyzeReference(ctx,ref,async(messages,fallback,options)=>{
    calls++
    if(options.videoPart)return {source:'gemini',data:{summary:'原片展示优惠',transcript:'原片字幕：新人领券。',segments:[{timing:'产品介绍',startSec:0,endSec:3,role:'产品',evidence:'新人领券',visual:'优惠卡片',audio:'旁白介绍优惠',explanation:'呈现原片利益'}],suggestions:[{...guidance[0],adaptation:'当前品牌也可以领券省钱'}],limitations:'无投放数据'}}
    assert.match(messages[0].content,/品牌事实校对/)
    return {source:'gemini',data:{suggestions:guidance}}
  },{inlineData:{mimeType:'video/mp4',data:'AAAA'}})
  assert.equal(calls,2)
  assert.equal(result.segments[0].timing,'0–3 秒')
  assert.equal(result.segments[0].evidence,'新人领券')
  assert.equal(result.suggestions[0].adaptation,guidance[0].adaptation)
})

test('multipart video upload rejects invalid bytes and retains server-issued metadata across library edits',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'reference-upload-test-'))
  const app=express(),upload=createVideoUpload(root)
  app.post('/upload',async(req,res)=>{try{res.json(await upload(req,res))}catch(e){res.status(e.status||500).json({error:e.message})}})
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))})
  const url=`http://127.0.0.1:${server.address().port}/upload`
  try{
    const send=async(bytes)=>{const form=new FormData();form.set('file',new Blob([bytes],{type:'video/mp4'}),'reference.mp4');return fetch(url,{method:'POST',body:form})}
    assert.equal((await send('not a video')).status,400)
    const res=await send('0000ftypisom00000000'),video=await res.json()
    assert.equal(res.status,200);assert.match(video.url,/^\/media\/reference-/)
    const {createReferenceStore}=await import('../src/server/inspirations.js')
    const store=createReferenceStore(root),ref=normalizeReference({title:'video',platform:'douyin',industry:'mobility',sourceUrl:'https://example.com/video'})
    await store.import([ref]);await store.attachVideo(ref.id,video)
    await store.update(ref.id,{title:'edited',video:{url:'/media/../../.env'}})
    assert.deepEqual((await store.read())[0].video,video)
    await store.import([normalizeReference({...ref,title:'reimported'})])
    assert.deepEqual((await store.read())[0].video,video)
    assert.equal((await readReferenceVideo(video,root)).inlineData.mimeType,'video/mp4')
  }finally{
    await new Promise(resolve=>server.close(resolve))
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(root).startsWith('reference-upload-test-'));await fs.rm(root,{recursive:true,force:true})
  }
})

test('selected reference guidance survives storyboard, regeneration and final video prompt compilation',()=>{
  const concept={id:'new',inspiration},shot={id:'s1',referenceUse:use,prompt:'Target scene',durationSec:3}
  const context={...ctx,brief:ctx.project.brief,concept,channel:{},globalContext:{},shot,neighbors:[]}
  assert.match(storyboardMessages(context)[1].content,/先呈现动作/)
  assert.match(shotRegenMessages(context)[1].content,/referenceUse/)
  const shots=bindStoryboardReference([shot],concept,'gemini')
  const compiled=compileShotRenderPrompt({...context,shot:shots[0],inspiration})
  assert.match(compiled.prompt,/Close-up of a hand/)
  assert.match(compiled.prompt,/no on-screen text/)
  assert.deepEqual(compiled.referenceUse.suggestionIds,['hook'])
  assert.throws(()=>bindStoryboardReference([{id:'s1'}],concept,'gemini'),/遗漏/)
  assert.throws(()=>bindStoryboardReference([shot],concept,'mock-fallback'),e=>e.status===503)
  assert.throws(()=>bindStoryboardReference([{...shot,referenceUse:{...use,suggestionIds:['cta']}}],concept,'gemini'),/未选/)
  assert.equal(compileShotRenderPrompt({...context,shot,inspiration:null}).referenceUse,null)
})

test('switching or editing a concept retains old work but blocks generation from its stale storyboard',()=>{
  const original={id:'old',title:'原方案'},project={concepts:[original,{id:'new'}],selectedConceptId:'old',storyboard:{conceptId:'old',conceptFingerprint:conceptFingerprint(original)},render:{finalVideo:'existing.mp4'}}
  assert.doesNotThrow(()=>assertStoryboardCurrent(project))
  project.selectedConceptId='new'
  assert.throws(()=>assertStoryboardCurrent(project),e=>e.status===409)
  assert.equal(project.render.finalVideo,'existing.mp4')
  project.selectedConceptId='old';original.title='修改后'
  assert.throws(()=>assertStoryboardCurrent(project),e=>e.status===409)
})
