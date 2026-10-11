import { getProject, updateBatch } from './store.js'
import { batchView, createBatch, runCreativePipeline } from './batch.js'
import { failure } from './experiments.js'
import { deliveryFiles, zipFiles } from './delivery.js'
import { assertStoryboardCurrent } from './inspiration-guidance.js'
import { randomUUID } from 'node:crypto'
import { hasFfmpeg } from './providers/ffmpeg.js'

export function registerBatchRoutes(app, { wrap, invoke, loadContext }) {
  const running = new Map()
  // Prevent edits from racing a paid generation request or a batch save.
  app.use('/api/projects/:id', async (req, res, next) => {
    try {
      if (!['PATCH', 'POST', 'DELETE'].includes(req.method) || req.path === '/batch/pause') return next()
      const project = await getProject(req.params.id)
      if (running.has(project?.batchId || project?.id)) return res.status(409).json({ error: '这批素材正在处理。请先暂停，待当前步骤完成后编辑。' })
      next()
    } catch (error) { next(error) }
  })
  app.post('/api/projects/:id/batch/creatives', wrap(async (req, res) => {
    const project = await updateBatch(req.params.id, p => createBatch(p, req.body))
    res.json(project)
  }))
  app.get('/api/projects/:id/batch', wrap(async (req, res) => {
    const p = await getProject(req.params.id)
    if (!p) throw failure('项目不存在', 404)
    const root = p.batchId ? await getProject(p.batchId) : p
    const batch = batchView(root)
    if (batch.job?.status === 'running' && !running.has(root.id)) {
      batch.job.status = 'paused'; batch.job.message = '服务已重启；已完成内容保留，可继续未完成素材。'
    }
    res.json(batch)
  }))
  app.post('/api/projects/:id/batch/pause', wrap(async (req, res) => {
    const project = await getProject(req.params.id)
    const task = running.get(project?.batchId || project?.id)
    if (task) task.cancelled = true
    res.json({ ok: true, message: '当前步骤完成后暂停，已提交的远程任务保留' })
  }))
  app.post('/api/projects/:id/batch/run', wrap(async (req, res) => {
    const parent = await getProject(req.params.id)
    if (!parent || parent.batchId || parent.experimentLink) throw failure('请选择素材所属项目')
    const stage = req.body.stage
    if (!['storyboard', 'review', 'produce'].includes(stage)) throw failure('请选择分镜、审核或制作阶段')
    const available = batchView(parent).items.map(c => c.id)
    const ids = Array.isArray(req.body.ids) ? [...new Set(req.body.ids)] : available
    if (!ids.length || ids.some(id => !available.includes(id))) throw failure('请选择本项目中的有效素材')
    if (stage === 'produce' && !await hasFfmpeg()) throw failure('请先配置 FFmpeg，才能批量制作完整视频。尚未提交模型任务。', 422)
    if (running.has(parent.id)) throw failure('这批素材已在处理，请勿重复提交', 409)
    const task = { cancelled: false }
    running.set(parent.id, task)
    const job = { id: randomUUID(), stage, status: 'running', startedAt: new Date().toISOString(), items: ids.map(id => ({ id, status: 'queued', step: '', message: '' })) }
    try { await updateBatch(parent.id, p => { p.batchJob = job }) }
    catch (error) { running.delete(parent.id); throw error }
    res.json(job)
    const save = () => updateBatch(parent.id, p => { p.batchJob = structuredClone(job) })
    void (async () => {
      try {
        for (const item of job.items) {
          if (task.cancelled) break
          item.status = 'running'; await save()
          try {
            item.message = await runCreativePipeline(item.id, stage, {
              load: async id => (await loadContext(id)).project, invoke,
              progress: async step => { item.step = step; await save() },
              cancelled: () => task.cancelled,
              wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
            })
            item.status = 'done'
          } catch (error) { item.status = task.cancelled ? 'paused' : 'attention'; item.message = error.message }
          await save()
        }
        job.status = task.cancelled ? 'paused' : job.items.some(i => i.status === 'attention') ? 'attention' : 'done'
      } catch (error) { job.status = 'attention'; job.message = error.message }
      finally { job.finishedAt = new Date().toISOString(); try { await save() } finally { running.delete(parent.id) } }
    })().catch(error => console.error('[batch]', error.message))
  }))
  app.get('/api/projects/:id/batch/delivery.zip', wrap(async (req, res) => {
    const parent = await getProject(req.params.id)
    if (!parent || parent.batchId) throw failure('请选择素材所属项目')
    const requested = String(req.query.ids || '').split(',').filter(Boolean)
    const items = batchView(parent).items.filter(i => requested.length ? requested.includes(i.id) : i.videoUrl && !i.stale)
    if (!items.length || requested.some(id => !items.some(i => i.id === id))) throw failure('请选择已有当前成片的素材')
    const files = []
    for (const item of items) {
      const { project } = await loadContext(item.id)
      assertStoryboardCurrent(project)
      if (!project.render.finalVideo || project.render.finalVideo.stale || project.storyboard?.shots.some(s => project.render.shots[s.id]?.stale)) throw failure(`${item.name} 的成片需更新`, 409)
      files.push(...await deliveryFiles(project))
    }
    files.push({ name: 'batch-manifest.json', bytes: JSON.stringify({ project: parent.name, count: items.length, items }, null, 2) })
    res.set('Content-Disposition', `attachment; filename="batch-${parent.id}.zip"`).type('application/zip').send(zipFiles(files))
  }))
}
