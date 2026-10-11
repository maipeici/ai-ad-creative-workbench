import { DATA_DIR } from './config.js'
import { upsertProject } from './store.js'
import { llmJson } from './providers/llm.js'
import { PLATFORMS, INDUSTRIES, DEMO_REFERENCES, createReferenceStore, normalizeReference, parseImport, recommendReferences, platformForChannel, defaultIndustry, analyzeReference, reuseReference, referenceFingerprint } from './inspirations.js'

export function registerInspirationRoutes(app,{wrap,loadContext,referenceStore=createReferenceStore(DATA_DIR),saveProject=upsertProject,evaluate=llmJson}) {
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
      defaults:{platform:platformForChannel(ctx.project?.brief?.channel),industry:defaultIndustry(ctx.brandGuide)}})
  }))
  app.post('/api/inspirations',wrap(async(req,res)=>{const [item]=await store.import([normalizeReference(req.body)]);res.json(item)}))
  app.post('/api/inspirations/import',wrap(async(req,res)=>{const items=parseImport(req.body?.content,req.body?.format);res.json({items:await store.import(items),count:items.length})}))
  app.patch('/api/inspirations/:referenceId',wrap(async(req,res)=>{
    if(req.params.referenceId.startsWith('demo-'))return res.status(400).json({error:'内置结构示例只读；可以另行导入自己的参考。'})
    res.json(await store.update(req.params.referenceId,req.body))
  }))
  app.post('/api/projects/:id/inspirations/:referenceId/analyze',wrap(async(req,res)=>{
    const ctx=await loadContext(req.params.id),ref=await find(req.params.referenceId)
    const analysis=await analyzeReference(ctx,ref,evaluate)
    const project=await current(req.params.id,ref,analysis.fingerprint)
    project.inspirationAnalyses={...project.inspirationAnalyses,[ref.id]:analysis}
    await saveProject(project)
    res.json({project,analysis})
  }))
  app.post('/api/projects/:id/inspirations/:referenceId/apply',wrap(async(req,res)=>{
    const ctx=await loadContext(req.params.id),ref=await find(req.params.referenceId)
    const analysis=ctx.project.inspirationAnalyses?.[ref.id]
    const concept=await reuseReference(ctx,ref,analysis,req.body?.suggestionIds,evaluate)
    const project=await current(req.params.id,ref,analysis.fingerprint)
    project.concepts=[...(project.concepts||[]),concept]
    if(!project.selectedConceptId)project.selectedConceptId=concept.id
    project.phase=Math.max(project.phase||1,3)
    await saveProject(project)
    res.json({project,concept})
  }))
}
