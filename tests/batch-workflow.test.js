import test from 'node:test'
import assert from 'node:assert/strict'
import { createBatch, batchView, projectCreative, runCreativePipeline } from '../src/server/batch.js'
import { buildReviewPolicy } from '../src/server/review-policy.js'
import { runAutomaticReview } from '../src/server/review.js'
import { createMaterialTest, assertSingleVariable } from '../src/server/material-tests.js'
import { normalizeQuality } from '../src/server/delivery.js'
import { autoFix } from '../src/server/autofix.js'
import { experimentReport } from '../src/server/experiments.js'

function fixture() {
  return { id: 'project', name: 'Batch', brandGuideId: 'brand', phase: 3, assets: {}, facts: [], brief: { channel: 'channel', durationSec: 6, audience: 'new', deliveryCount: 12 },
    concepts: ['one', 'two', 'three'].map(id => ({ id, title: id })), selectedConceptId: 'one', storyboard: null,
    review: { requirements: [], approved: false }, render: { shots: {}, finalVideo: null }, variants: [] }
}
function filmed() {
  const p = fixture()
  p.storyboard = { globalContext: {}, shots: [{ id: 's1', index: 1, role: 'hook', vo: '出门了', durationSec: 3, prompt: 'commuter' }, { id: 's2', index: 2, role: 'cta', vo: '打开叫车', durationSec: 3, prompt: 'car' }] }
  p.render = { shots: { s1: { url: '/media/first.mp4' }, s2: { url: '/media/fixed.mp4' } }, finalVideo: { url: '/media/final.mp4' } }
  return p
}
test('3 directions x 4 versions creates twelve independent creatives; old media remains first', () => {
  const p = createBatch(fixture(), { conceptIds: ['one', 'two', 'three'], versionsPerConcept: 4 })
  assert.equal(batchView(p).items.length, 12)
  p.creatives[0].review.approved = true
  assert.equal(p.creatives[1].review.approved, false)
  const old = filmed(); const video = structuredClone(old.render)
  createBatch(old, { conceptIds: ['two'], versionsPerConcept: 2 })
  assert.deepEqual(old.render, video)
  assert.equal(batchView(old).items.length, 3)
  assert.throws(() => createBatch(old, { conceptIds: ['missing'], versionsPerConcept: 2 }))
})
test('creative projection shares brief while controlled variants can preserve their recorded conditions', () => {
  const p = createBatch(fixture(), { conceptIds: ['one'], versionsPerConcept: 2 })
  const item = p.creatives[0]
  assert.deepEqual(projectCreative(p, item).brief, p.brief)
  item.sharedSnapshot = { brief: { channel: 'old-channel' } }
  p.brief.channel = 'new-channel'
  assert.equal(projectCreative(p, item).brief.channel, 'old-channel')
  assert.equal(projectCreative(p, item).experiments, undefined)
})
test('production resumes an existing remote shot without resubmission, skips completed clips, assembles and checks quality', async () => {
  const p = filmed(); p.review.approved = true; p.render.finalVideo = null
  p.render.shots.s1 = { status: 'running', taskId: 'remote-existing' }
  const calls = []
  const result = await runCreativePipeline(p.id, 'produce', { load: async () => p, progress: async () => {}, cancelled: () => false, wait: async () => {}, invoke: async (_, key) => {
    calls.push(key)
    if (key === 'poll') p.render.shots.s1 = { url: '/media/done.mp4', status: 'succeeded' }
    if (key === 'assemble') { p.render.finalVideo = { url: '/media/new.mp4' }; return { ffmpeg: true } }
    if (key === 'quality') p.render.qualityReview = { status: 'passed' }
  } })
  assert.deepEqual(calls, ['poll', 'assemble', 'quality']); assert.match(result, /完成/)
})
test('review blocker prevents paid video submission and cancellation preserves current state', async () => {
  const p = filmed(); const calls = []
  await assert.rejects(runCreativePipeline(p.id, 'produce', { load: async () => p, invoke: async (_, action) => calls.push(action), progress: async () => {}, cancelled: () => false }), /审核未通过/)
  assert.deepEqual(calls, ['review'])
  await assert.rejects(runCreativePipeline(p.id, 'review', { load: async () => p, invoke: async () => assert.fail('must not submit'), progress: async () => {}, cancelled: () => true }), /暂停/)
})
test('brand and platform rules are combined; missing platform coverage cannot be overridden by the model', async () => {
  const p = filmed()
  const ctx = { project: p, brandGuide: { copyRules: ['不得承诺固定到达时间'], format: {} }, compliance: { rules: [] }, assetLib: { items: [], categories: [] }, factLib: { facts: [] }, channel: { id: 'channel' } }
  ctx.reviewPolicy = buildReviewPolicy(ctx, { version: 'v1', profiles: [] })
  assert.ok(ctx.reviewPolicy.rules.some(r => r.group === 'brand'))
  assert.ok(ctx.reviewPolicy.rules.some(r => r.group === 'platform' && r.requiredInput))
  const result = await runAutomaticReview(ctx, { autoRepair: false }, { validate: () => ({ summary: { blockers: 0, autoFixable: 0 } }), llmJson: async messages => ({ source: 'llm', data: { checks: JSON.parse(messages[1].content).checklist.map(c => ({ id: c.id, status: 'pass', evidence: '模型声称本项已经满足要求' })) } }) })
  assert.equal(result.project.review.approved, false)
  assert.equal(result.project.review.results.find(c => c.ruleId === 'platform-missing').status, 'needs-input')
  assert.equal(result.project.review.requirements.length, 0, 'combined rules must not be copied into optional requirements')
})
test('final quality requires brand/platform evidence in addition to the five media checks', () => {
  const p = filmed()
  const result = { source: 'gemini', data: { checks: ['visual', 'text', 'audio', 'facts', 'delivery'].map(id => ({ id, status: 'pass', evidence: '实际成片符合检查项', timing: '0–6s' })) } }
  const review = normalizeQuality(result, p, { rules: [{ id: 'brand', group: 'brand', source: '品牌', label: '产品表述' }] })
  assert.equal(review.status, 'needs-input')
  assert.equal(review.results.at(-1).id, 'policy-brand')
})
test('a material test references existing video ids; unrelated creative differences cannot claim single-variable control', () => {
  const a = filmed(), b = structuredClone(a); b.id = 'b'; b.storyboard.shots[0].vo = '下班叫车'; b.render.shots.s1.url = '/media/b.mp4'
  assert.doesNotThrow(() => assertSingleVariable([a,b], 'hook'))
  const group = createMaterialTest(a, [a,b], { mode: 'single-variable', variable: 'hook', primaryMetric: 'ctr', hypothesis: '开头表达是否影响点击' })
  assert.deepEqual(group.versions.map(v => v.projectId), ['project', 'b'])
  b.render.shots.s2.url = '/media/regenerated-fixed.mp4'
  assert.throws(() => assertSingleVariable([a,b], 'hook'), /单变量条件/)
  assert.doesNotThrow(() => createMaterialTest(a, [a,b], { mode: 'comparison', primaryMetric: 'ctr', hypothesis: '比较两个创意' }))
})

test('repairing one batch item cannot change shared fact selections', async () => {
  const p = filmed(); p.batchId = 'parent'; p.facts = ['unconfirmed']
  const validation = { global: [{ fix: { auto: true, action: 'deselect-fact', payload: { factIds: ['unconfirmed'] } } }], shots: [{ shotId: 's1', issues: [{ fix: { action: 'select-fact', payload: { factIds: ['confirmed'] } } }] }] }
  const result = await autoFix({ project: p, brandGuide: {}, compliance: {}, factLib: { facts: [] }, facts: { confirmed: [] }, picked: {}, validation })
  assert.deepEqual(result.project.facts, ['unconfirmed'])
  assert.equal(result.report.needsManual.length, 2)
})

test('batch processing does not silently accept a storyboard for a different concept', async () => {
  const p = filmed(); p.storyboard.conceptId = 'old'
  await assert.rejects(runCreativePipeline(p.id, 'storyboard', { load: async () => p, invoke: async () => assert.fail('must preserve existing work') }), /创意已变更/)
})

test('zero-denominator observations remain insufficient for comparison', () => {
  const a = filmed(), b = structuredClone(a); b.id = 'b'
  const group = createMaterialTest(a, [a,b], { mode: 'comparison', primaryMetric: 'cpa', hypothesis: '比较转化成本' })
  group.observations = [a,b].map(p => ({ projectId: p.id, startDate: '2026-10-01', endDate: '2026-10-02', impressions: 100, clicks: 2, conversions: 0, spend: 20, videoUrl: p.render.finalVideo.url }))
  assert.equal(experimentReport(group, [a,b]).comparable, false)
})
