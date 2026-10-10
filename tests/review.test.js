import test from 'node:test'
import assert from 'node:assert/strict'
import { runAutomaticReview, normalizeAgentChecks, applyAgentPatches } from '../src/server/review.js'
import { normalizeRequirements, refreshReview, reviewInputFingerprint } from '../src/server/review-state.js'

function context() {
  return {
    project: {
      id: 'review-test', phase: 4, assets: {}, facts: ['feature'], brief: { durationSec: 10 },
      concepts: [], selectedConceptId: null,
      storyboard: { globalContext: {}, shots: [
        { id: 's1', index: 1, role: 'hook', titleCn: '开头', durationSec: 3, vo: '下班了', subtitle: '', renderMode: 'ai', prompt: 'A person', action: 'walk', uiRefs: [], factRefs: [], overlayItems: [] },
        { id: 's2', index: 2, role: 'cta', titleCn: '行动引导', durationSec: 7, vo: '打开花小猪叫车', subtitle: '', renderMode: 'ai', prompt: 'A car', action: 'arrive', uiRefs: [], factRefs: ['feature'], overlayItems: [] },
      ] },
      review: { approved: false, notes: '', requirements: ['行动引导具体'] },
    },
    brandGuide: { format: { defaultDuration: 10 } },
    assetLib: { categories: [], items: [] },
    factLib: { facts: [{ id: 'feature', type: 'feature', status: 'confirmed', statement: '可以发起叫车' }] },
    compliance: { rules: [], requireFactBinding: { patterns: [] } },
    channel: null,
  }
}
const pass = () => ({ source: 'llm', data: { checks: [{ id: 'check-1', status: 'pass', evidence: '镜头 #2 明确引导打开花小猪叫车。' }] } })

test('automatic approval requires all checklist results and a clean rule validation', async () => {
  const ctx = context()
  const result = await runAutomaticReview(ctx, { autoRepair: false }, { llmJson: async () => pass() })
  assert.equal(result.project.review.approved, true)
  assert.equal(result.project.review.mode, 'automatic')
  assert.equal(result.project.review.status, 'passed')
  assert.equal(result.project.review.fingerprint, reviewInputFingerprint(ctx))
})

test('model success cannot override a rule blocker', async () => {
  const ctx = context()
  ctx.project.storyboard.shots[1].role = 'scene'
  const result = await runAutomaticReview(ctx, { autoRepair: false }, { llmJson: async () => pass() })
  assert.ok(result.validation.summary.blockers > 0)
  assert.equal(result.project.review.approved, false)
  assert.equal(result.project.review.status, 'blocked')
})

test('mock fallback, missing results, duplicate ids and missing evidence never pass', async () => {
  for (const response of [
    { ...pass(), source: 'mock-fallback' },
    { source: 'llm', data: {} },
    { source: 'llm', data: { checks: [...pass().data.checks, ...pass().data.checks] } },
    { source: 'llm', data: { checks: [{ id: 'check-1', status: 'pass', evidence: '' }] } },
  ]) {
    const result = await runAutomaticReview(context(), { autoRepair: false }, { llmJson: async () => response })
    assert.equal(result.project.review.approved, false)
    assert.equal(result.project.review.results[0].status, 'needs-input')
  }
})

test('every custom requirement is required even if the agent omits one', () => {
  const checks = normalizeAgentChecks(pass(), ['CTA 清晰', '不使用夸大表述'])
  assert.equal(checks.length, 2)
  assert.equal(checks[1].status, 'needs-input')
})

test('an agent repair is followed by an independent recheck and records the text diff', async () => {
  let calls = 0
  const ctx = context()
  ctx.project.render = { shots: { s2: { url: '/media/old.mp4', approved: true } } }
  const result = await runAutomaticReview(ctx, {}, { llmJson: async messages => {
    calls++
    if (calls === 1) return {
      source: 'llm',
      data: { checks: [{ id: 'check-1', status: 'block', evidence: '镜头 #2 的 CTA 可以更明确。' }], shotPatches: [{ shotId: 's2', changes: { vo: '打开花小猪，一键叫车' } }] },
    }
    assert.match(messages[0].content, /最终复检/)
    assert.equal(JSON.parse(messages[1].content).storyboard.shots[1].vo, '打开花小猪，一键叫车')
    return { source: 'llm', data: { checks: [{ id: 'check-1', status: 'needs-input', evidence: '镜头 #2 的使用条件仍需提供依据。' }] } }
  } })
  assert.equal(ctx.project.render.shots.s2.stale, true)
  assert.equal(ctx.project.render.shots.s2.approved, false)
  assert.equal(ctx.project.render.shots.s2.url, '/media/old.mp4')
  assert.equal(calls, 2)
  assert.equal(result.project.review.approved, false)
  assert.equal(result.report.applied[0].before.vo, '打开花小猪叫车')
  assert.equal(result.report.applied[0].after.vo, '打开花小猪，一键叫车')
  assert.equal(result.project.review.history.length, 2)
})

test('rule repairs are revalidated and all selected-fact changes are kept', async () => {
  const ctx = context()
  ctx.project.storyboard.shots[1].role = 'scene'
  let repaired = false
  const result = await runAutomaticReview(ctx, {}, {
    llmJson: async () => pass(),
    autoFix: async ({ project }) => {
      repaired = true
      project.storyboard.shots[1].role = 'cta'
      project.facts = []
      return { report: { applied: [{ scope: '镜头 #2', detail: '补齐 CTA' }], skipped: [], needsManual: [] } }
    },
  })
  assert.equal(repaired, true)
  assert.equal(result.after.blockers, 0)
  assert.deepEqual(result.project.facts, [])
  assert.equal(result.project.review.approved, true)
})

test('agent patches cannot change assets, shot identity or create unconfirmed fact references', () => {
  const ctx = context()
  ctx.facts = { confirmed: ctx.factLib.facts }
  applyAgentPatches(ctx, [{ shotId: 's2', changes: { id: 'other', uiRefs: ['fake-logo'], factRefs: ['invented'], renderMode: 'asset', vo: '打开花小猪' } }])
  const shot = ctx.project.storyboard.shots[1]
  assert.equal(shot.id, 's2')
  assert.deepEqual(shot.uiRefs, [])
  assert.deepEqual(shot.factRefs, ['feature'])
  assert.equal(shot.renderMode, 'ai')
  assert.equal(shot.vo, '打开花小猪')
})

test('edits to storyboard, checklist, shared facts or visual settings make approval stale', async () => {
  for (const change of [
    ctx => { ctx.project.storyboard.shots[0].vo = '内容已修改' },
    ctx => { ctx.project.review.requirements.push('不得出现雨天') },
    ctx => { ctx.factLib.facts[0].statement = '功能已调整' },
    ctx => { ctx.brandGuide.visualStyle = { label: 'new style' } },
  ]) {
    const ctx = context()
    await runAutomaticReview(ctx, { autoRepair: false }, { llmJson: async () => pass() })
    change(ctx)
    refreshReview(ctx)
    assert.equal(ctx.project.review.approved, false)
    assert.equal(ctx.project.review.status, 'stale')
  }
})

test('preview generation and navigation do not invalidate the reviewed storyboard', async () => {
  const ctx = context()
  await runAutomaticReview(ctx, { autoRepair: false }, { llmJson: async () => pass() })
  ctx.project.storyboard.shots[0].preview = { url: '/media/preview.png' }
  ctx.project.phase = 6
  ctx.project.updatedAt = new Date().toISOString()
  refreshReview(ctx)
  assert.equal(ctx.project.review.approved, true)
})

test('legacy manual approval cannot be reused as an automatic review result', () => {
  const ctx = context()
  ctx.project.review.approved = true
  refreshReview(ctx)
  assert.equal(ctx.project.review.approved, false)
})

test('empty storyboard and malformed checklists are rejected before any model call', async () => {
  assert.throws(() => normalizeRequirements([]), /1–30/)
  assert.throws(() => normalizeRequirements([' ']), /1–30/)
  assert.throws(() => normalizeRequirements(['x'.repeat(301)]), /1–30/)
  assert.deepEqual(normalizeRequirements(['  a  ', 'a']), ['a'])
  const ctx = context()
  ctx.project.storyboard.shots = []
  await assert.rejects(() => runAutomaticReview(ctx, {}, { llmJson: () => { throw new Error('must not call') } }), /至少一个分镜/)
})
