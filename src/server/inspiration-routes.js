import { DATA_DIR, config } from './config.js'
import { createVideoUpload, readReferenceVideo, requireVideoModel } from './inspiration-video.js'
import { upsertProject } from './store.js'
import { llmJson } from './providers/llm.js'
import { PLATFORMS, INDUSTRIES, DEMO_REFERENCES, createReferenceStore, normalizeReference, parseImport, recommendReferences, platformForChannel, defaultIndustry, analyzeReference, reuseReference, referenceFingerprint } from './inspirations.js'

export function registerInspirationRoutes(app,{wrap,loadContext,referenceStore=createReferenceStore(DATA_DIR),saveProject=upsertProject,evaluate=llmJson,uploadVideo=createVideoUpload(),readVideo=readReferenceVideo,checkVideoModel=requireVideoModel}) {
  const store=referenceStore
  const find=async id=>{
    const ref=[...await store.read(),...DEMO_REFERENCES].find(r=>r.id===id&&!r.archived)
    if(!ref)throw Object.assign(new Error('参考素材不存在或已归档。'),{status:404})
    return ref
  }
  const current=async(projectId,ref,fingerprint)=>{
    const ctx=await loadContext(projectId),latest=await find(ref.id)
    if(referenceFingerprint(ctx,latest)!==fingerprint)throw Object.assign(new Error('生成期间项目或参考资料发生变化，请刷新并重新拆解。'),{status:409})
    return ctx.project
  }
  app.get('/api/inspirations',wrap(async(req,res)=>{
    const ctx=req.query.projectId?await loadContext(String(req.query.projectId)):{}
    const all=await store.read(),demo=req.query.mode==='demo'
    const items=demo?[...DEMO_REFERENCES,...all.filter(r=>r.isDemo)]:all.filter(r=>!r.isDemo)
    res.json({items:recommendReferences(items,req.query,ctx),platforms:PLATFORMS,industries:INDUSTRIES,
      importedCount:all.filter(r=>!r.archived&&!r.isDemo).length,mode:demo?'demo':'imported',
      videoAnalysisAvailable:Boolean(config.vertex.enabled),
      defaults:{platform:platformForChannel(ctx.project?.brief?.channel),industry:defaultIndustry(ctx.brandGuide)}})
  }))
  app.post('/api/inspirations',wrap(async(req,res)=>{const [item]=await store.import([normalizeReference(req.body)]);res.json(item)}))
  app.post('/api/inspirations/import',wrap(async(req,res)=>{const items=parseImport(req.body?.content,req.body?.format);res.json({items:await store.import(items),count:items.length})}))
  app.patch('/api/inspirations/:referenceId',wrap(async(req,res)=>{
    if(req.params.referenceId.startsWith('demo-'))return res.status(400).json({error:'内置结构示例只读；可以另行导入自己的参考。'})
    res.json(await store.update(req.params.referenceId,req.body))
  }))
  app.post('/api/inspirations/:referenceId/video',wrap(async(req,res)=>{
    const ref=await find(req.params.referenceId)
    if(ref.id.startsWith('demo-'))throw Object.assign(new Error('请创建自己的参考后上传视频。'),{status:400})
    checkVideoModel()
    const video=await uploadVideo(req,res)
    res.json(await store.attachVideo(ref.id,video))
  }))
  app.post('/api/projects/:id/inspirations/:referenceId/analyze',wrap(async(req,res)=>{
    const ctx=await loadContext(req.params.id),ref=await find(req.params.referenceId)
    if(ref.video)checkVideoModel()
    const analysis=await analyzeReference(ctx,ref,evaluate,ref.video?await readVideo(ref.video):null)
    const project=await current(req.params.id,ref,analysis.fingerprint)
    project.inspirationAnalyses={...project.inspirationAnalyses,[ref.id]:analysis}
    await saveProject(project)
    res.json({project,analysis})
  }))
  app.post('/api/projects/:id/inspirations/:referenceId/apply',wrap(async(req,res)=>{
    const ctx=await loadContext(req.params.id),ref=await find(req.params.referenceId)
    const analysis=ctx.project.inspirationAnalyses?.[ref.id]
    const targetId=req.body?.targetConceptId
    const target=targetId?ctx.project.concepts?.find(c=>c.id===targetId):null
    if(targetId&&!target)throw Object.assign(new Error('要参考改写的创意已不存在，请刷新。'),{status:409})
    const concept=await reuseReference(ctx,ref,analysis,req.body?.suggestionIds,evaluate,target)
    const project=await current(req.params.id,ref,analysis.fingerprint)
    if(target&&JSON.stringify(project.concepts?.find(c=>c.id===target.id))!==JSON.stringify(target))throw Object.assign(new Error('生成期间原创意发生变化，请重新应用。'),{status:409})
    project.concepts=[...(project.concepts||[]),concept]
    if(!project.selectedConceptId)project.selectedConceptId=concept.id
    if(req.body?.selectAfterApply===true)project.selectedConceptId=concept.id
    project.phase=Math.max(project.phase||1,3)
    await saveProject(project)
    res.json({project,concept})
  }))
}
