import { upsertProject } from './store.js'
import { deliveryFiles, zipFiles, reviewFinalVideo, qualityFingerprint } from './delivery.js'
import { assertStoryboardCurrent } from './inspiration-guidance.js'
import { failure } from './experiments.js'
import { reviewInputFingerprint } from './review-state.js'

export function registerDeliveryRoutes(app, { wrap, loadContext }) {
  const running = new Set()
  app.post('/api/projects/:id/quality-review', wrap(async (req, res) => {
    if (running.has(req.params.id)) throw failure('该成片正在质检，请稍后查看', 409)
    running.add(req.params.id)
    try {
      const ctx = await loadContext(req.params.id)
      assertStoryboardCurrent(ctx.project)
      const before = qualityFingerprint(ctx.project)
      const contextBefore = reviewInputFingerprint(ctx)
      const review = await reviewFinalVideo(ctx)
      const latest = await loadContext(req.params.id)
      if (qualityFingerprint(latest.project) !== before || reviewInputFingerprint(latest) !== contextBefore) throw failure('质检期间成片或资料已变更，请重新检查', 409)
      review.contextFingerprint = contextBefore
      latest.project.render.qualityReview = review
      await upsertProject(latest.project)
      res.json(latest.project)
    } finally { running.delete(req.params.id) }
  }))
  app.get('/api/projects/:id/delivery.zip', wrap(async (req, res) => {
    const { project } = await loadContext(req.params.id)
    assertStoryboardCurrent(project)
    if (project.render?.finalVideo?.stale) throw failure('当前成片已过期，请重新合成后交付', 409)
    if (project.storyboard?.shots.some(s => project.render.shots[s.id]?.stale)) throw failure('镜头已变更，请重新制作当前成片后交付', 409)
    const bytes = zipFiles(await deliveryFiles(project))
    res.set('Content-Disposition', `attachment; filename="delivery-${project.id}.zip"`).type('application/zip').send(bytes)
  }))
  app.get('/api/projects/:id/experiments/:experimentId/delivery.zip', wrap(async (req, res) => {
    const { project } = await loadContext(req.params.id)
    const experiment = project.experiments?.find(e => e.id === req.params.experimentId)
    if (!experiment || experiment.versions.length < 2) throw failure('请先准备至少 A/B 两个版本')
    const files = []
    for (const version of experiment.versions) {
      const { project: candidate } = await loadContext(version.projectId)
      if (!candidate?.render.finalVideo) throw failure(`${version.label} 版尚未完成成片`)
      if (candidate.render.finalVideo.stale) throw failure(`${version.label} 版成片已过期，请重新合成`)
      assertStoryboardCurrent(candidate)
      if (candidate.storyboard.shots.some(s => candidate.render.shots[s.id]?.stale)) throw failure(`${version.label} 版镜头已变更，请重新制作`)
      files.push(...await deliveryFiles(candidate))
    }
    files.push({ name: 'experiment.json', bytes: JSON.stringify(experiment, null, 2) })
    res.set('Content-Disposition', `attachment; filename="experiment-${experiment.id}.zip"`).type('application/zip').send(zipFiles(files))
  }))
}
