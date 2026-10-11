import test from 'node:test'
import assert from 'node:assert/strict'
import { makeVersionPlan, constrainVersionStoryboard, assertVersionContract, splitLegacyProjects, versionPrompt } from '../src/server/video-versions.js'
import { createBatch, batchView, projectCreative } from '../src/server/batch.js'
import { reviewProjectFingerprint } from '../src/server/review-state.js'
import { applyAgentPatches } from '../src/server/review.js'

function fixture() {
  return { id: 'root', name: '通勤广告', concepts: [{ id: 'idea', title: '通勤痛点', hook: '前三秒人物痛点展示' }], selectedConceptId: 'idea', assets: {}, brief: { durationSec: 6 },
    storyboard: { conceptId: 'idea', source: 'llm', globalContext: { coreIdea: '通勤痛点', person: 'commuter', scene: 'street' }, shots: [{ id: 'hook', index: 1, role: 'hook', durationSec: 3, action: 'waiting', prompt: 'waiting commuter', cameraAngle: 'wide', vo: '还在等车吗', factRefs: [], uiRefs: [] }, { id: 'cta', index: 2, role: 'cta', durationSec: 3, action: 'tap', prompt: 'phone', vo: '打开花小猪', factRefs: ['fact'], uiRefs: ['logo'] }] }, review: { approved: true }, render: { shots: { hook: { url: '/old.mp4' } }, finalVideo: { url: '/final.mp4' } } }
}
test('version generation retains fixed story structure, CTA and facts even when model changes them', () => {
  const p = fixture(), plan = makeVersionPlan(p, { allowedChanges: ['camera', 'performance'], hookStrategy: '人物痛点展示' })
  const candidate = structuredClone(p.storyboard)
  candidate.globalContext.person = 'different person'
  candidate.shots[0] = { ...candidate.shots[0], id: 'wrong', role: 'product', durationSec: 7, cameraAngle: 'close-up', action: 'looks at watch', vo: '领新优惠券' }
  candidate.shots[1].uiRefs = []; candidate.shots[1].vo = '免费领券'
  const result = constrainVersionStoryboard(candidate, plan)
  assert.deepEqual(result.shots.map(s => [s.id, s.role, s.durationSec, s.vo, s.uiRefs]), p.storyboard.shots.map(s => [s.id, s.role, s.durationSec, s.vo, s.uiRefs]))
  assert.equal(result.shots[0].cameraAngle, 'close-up'); assert.equal(result.shots[0].action, 'looks at watch')
  assert.equal(result.globalContext.person, 'commuter')
  assert.throws(() => constrainVersionStoryboard({ ...candidate, shots: [] }, plan), /镜头数量/)
  assert.match(versionPrompt(plan), /人物痛点展示/)
})
test('edits cannot bypass creative locks, allowed scope or remove the version plan', () => {
  const p = fixture(); p.versionPlan = makeVersionPlan(p, { allowedChanges: ['camera'], hookStrategy: '人物痛点展示' })
  const changed = structuredClone(p); changed.storyboard.shots[0].cameraAngle = 'close-up'
  assert.doesNotThrow(() => assertVersionContract(changed, p))
  changed.storyboard.shots[0].vo = 'new wording'
  assert.throws(() => assertVersionContract(changed, p), /允许变化范围/)
  const switched = structuredClone(p); switched.selectedConceptId = 'other'
  assert.throws(() => assertVersionContract(switched, p), /一条核心创意/)
  const unlocked = structuredClone(p); delete unlocked.versionPlan
  assert.throws(() => assertVersionContract(unlocked, p), /不可覆盖/)
})
test('creating versions preserves base media, snapshots the blueprint and invalidates approval', () => {
  const p = fixture(), before = reviewProjectFingerprint(p), media = structuredClone(p.render)
  createBatch(p, { versionCount: 12, allowedChanges: ['camera', 'wording'], hookStrategy: '人物痛点展示' })
  assert.equal(batchView(p).items.length, 12)
  assert.deepEqual(p.render, media); assert.equal(p.review.approved, false)
  assert.notEqual(reviewProjectFingerprint(p), before)
  assert.equal(p.creatives[0].storyboard, null)
  assert.equal(p.creatives[0].versionPlan.template.shots[0].vo, '还在等车吗')
  p.storyboard.shots[0].vo = 'base later edited'
  assert.equal(p.creatives[0].versionPlan.template.shots[0].vo, '还在等车吗')
  assert.equal(projectCreative(p, p.creatives[0]).selectedConceptId, 'idea')
  assert.throws(() => createBatch(fixture(), { versionCount: 2, allowedChanges: ['unknown'] }), /允许变化/)
  assert.throws(() => createBatch({ ...fixture(), storyboard: null }, { versionCount: 2 }), /基础分镜/)
})
test('automatic repairs respect the version scope while permitting confirmed evidence bindings', () => {
  const project = fixture(); project.versionPlan = makeVersionPlan(project, { allowedChanges: ['camera', 'wording'] })
  const ctx = { project, facts: { confirmed: [{ id: 'fact' }] } }
  applyAgentPatches(ctx, [{ shotId: 'hook', changes: { cameraAngle: 'close-up', action: 'new unapproved performance', factRefs: ['fact'] } }, { shotId: 'cta', changes: { vo: 'claim a reward' } }])
  assert.equal(project.storyboard.shots[0].cameraAngle, 'close-up')
  assert.equal(project.storyboard.shots[0].action, 'waiting')
  assert.deepEqual(project.storyboard.shots[0].factRefs, ['fact'])
  assert.equal(project.storyboard.shots[1].vo, '打开花小猪')
  assert.doesNotThrow(() => assertVersionContract(project, project))
})
test('legacy mixed batches split by idea without losing IDs, scripts, media or experiment references', () => {
  const p = fixture(); p.experiments = [{ id: 'exp', versions: [{ projectId: 'other1' }] }]
  p.creatives = [{ ...structuredClone(p), id: 'same', name: undefined }, ...['other1', 'other2'].map(id => ({ ...structuredClone(p), id, selectedConceptId: 'other', concepts: [{ id: 'other', title: '另一创意' }] }))]
  const before = [p, ...p.creatives].map(i => [i.id, i.storyboard, i.render])
  const split = splitLegacyProjects([p])
  assert.equal(split.length, 2)
  assert.deepEqual(split.flatMap(root => [root, ...root.creatives]).map(i => [i.id, i.storyboard, i.render]), before)
  assert.equal(split[0].experiments[0].versions[0].projectId, 'other1')
  assert.ok(split.every(root => root.creatives.every(c => c.selectedConceptId === root.selectedConceptId)))
  assert.deepEqual(splitLegacyProjects(split), split)
})
