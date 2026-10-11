import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createExperiment, createExperimentVersion, assertExperimentLock, assertFrozenMedia, parseCsv, normalizeObservations, mergeObservations, experimentReport } from '../src/server/experiments.js'
import { inheritResources, validateWorkspace } from '../src/server/workspace.js'
import { normalizeQuality, reviewFinalVideo, mediaFile, zipFiles, deliveryFiles } from '../src/server/delivery.js'
import { reviewInputFingerprint } from '../src/server/review-state.js'
import { compileShotRenderPrompt, resolveFacts } from '../src/server/prompts.js'
import { checkFactBinding } from '../src/server/validate.js'
import { assertRenderable } from '../src/server/providers/coupon.js'

function fixture() {
  return { id: 'source', name: '通勤推广', phase: 6, assets: { brand: ['logo'] }, facts: ['feature'], brief: { durationSec: 6, audience: 'commuter', goal: '下载', channel: 'douyin' }, concepts: [], selectedConceptId: null,
    storyboard: { globalContext: { person: 'An office worker' }, shots: ['hook', 'cta'].map((role, i) => ({ id: `s${i}`, index: i + 1, role, durationSec: 3, titleCn: role, actionCn: '上班族上车', prompt: 'Worker in a car', vo: '打开花小猪叫车', subtitle: '轻松叫车', uiRefs: [], factRefs: [], personRefs: [], sceneRefs: [], vehicleRefs: [], preview: null })) },
    review: { approved: true }, render: { model: '', params: {}, shots: { s0: { url: '/media/first.mp4', backend: 'manual' }, s1: { url: '/media/fixed.mp4', backend: 'manual' } }, finalVideo: { url: '/media/final.mp4' }, cover: null }, variants: [] }
}
const plan = { variable: 'hook', primaryMetric: 'ctr', hypothesis: '具体通勤困境可以提高点击' }
const row = (version, changes = {}) => ({ version, startDate: '2026-10-01', endDate: '2026-10-07', impressions: '1000', clicks: '10', conversions: '0', spend: '20', source: '测试夹具，不是真实投放结果', ...changes })
function experimentFixture() {
  const source = fixture(), { experiment, baseline } = createExperiment(source, plan)
  const { project: variant, version } = createExperimentVersion(baseline, experiment, { vo: '下班赶车太难了' })
  experiment.versions.push(version)
  variant.render.shots.s0 = { url: '/media/b-first.mp4', backend: 'manual' }
  variant.render.finalVideo = { url: '/media/b-final.mp4' }
  source.experiments = [experiment]
  return { source, experiment, baseline, variant, projects: [baseline, variant] }
}

test('resource inheritance excludes removed assets and expired/unconfirmed facts without changing existing tasks', () => {
  const assets = { categories: [{ id: 'brand' }], items: [{ id: 'logo', category: 'brand' }] }
  const facts = { facts: [{ id: 'valid', status: 'confirmed' }, { id: 'expired', status: 'confirmed', validTo: '2000-01-01' }, { id: 'draft', status: 'draft' }] }
  const workspace = { defaults: { assets: { brand: ['logo', 'removed'] }, facts: ['valid', 'expired', 'draft'] } }
  const project = inheritResources({ assets: {}, facts: [] }, workspace, assets, facts)
  assert.deepEqual(project.assets.brand, ['logo']); assert.deepEqual(project.facts, ['valid'])
  workspace.defaults.assets.brand.length = 0
  assert.deepEqual(project.assets.brand, ['logo'])
  assert.throws(() => validateWorkspace({ defaults: { assets: {}, facts: ['expired'] } }, assets, facts), /有效期/)
  assert.throws(() => validateWorkspace({ brandIdentity: { primaryColor: 'pink' } }, assets, facts), /十六/)
})

test('A is an independent snapshot; B reuses fixed media and only permits the chosen shot content', () => {
  const source = fixture(), { baseline, experiment } = createExperiment(source, plan)
  source.storyboard.shots[0].vo = '原任务后续变更'
  assert.notEqual(baseline.storyboard.shots[0].vo, source.storyboard.shots[0].vo)
  const { project } = createExperimentVersion(baseline, experiment, { vo: '赶上最后一班车', durationSec: 99, uiRefs: ['fake'] })
  assert.equal(project.storyboard.shots[0].durationSec, 3)
  assert.deepEqual(project.storyboard.shots[0].uiRefs, [])
  assert.equal(project.render.shots.s1.url, '/media/fixed.mp4')
  assert.equal(project.render.shots.s0, undefined); assert.equal(project.render.finalVideo, null)
  assert.doesNotThrow(() => assertExperimentLock(project))
  for (const change of [p => p.brief.audience = 'other', p => p.storyboard.shots[1].vo = 'other', p => p.storyboard.shots[0].durationSec = 4, p => p.render.shots.s1.url = '/media/other.mp4', p => p.render.voicePreset = 'other']) {
    const copy = structuredClone(project); change(copy); assert.throws(() => assertExperimentLock(copy, project), /锁定|固定镜头/)
  }
  const edited = structuredClone(project); edited.storyboard.shots[0].vo = '又一次改写'
  assert.doesNotThrow(() => assertExperimentLock(edited, project))
  assert.throws(() => createExperimentVersion(baseline, experiment, { durationSec: 9 }), /至少改变/)
})

test('A video freezes after a dependent version is created, while quality checks may change', () => {
  const { source, baseline, projects } = experimentFixture()
  const changed = structuredClone(baseline); changed.render.shots.s1.url = '/media/changed.mp4'
  assert.throws(() => assertFrozenMedia(changed, baseline, [source, ...projects]), /锁定/)
  const checked = structuredClone(baseline); checked.render.qualityReview = { status: 'needs-input' }
  assert.doesNotThrow(() => assertFrozenMedia(checked, baseline, [source, ...projects]))
})

test('CSV imports quoted text, rejects missing/invalid values, and differentiates zero conversions from no data', () => {
  const { experiment, projects } = experimentFixture()
  const csv = '\uFEFFversion,startDate,endDate,impressions,clicks,conversions,spend,source\r\nA,2026-10-01,2026-10-07,1000,10,0,20,"示例,来源"'
  const normalized = normalizeObservations(parseCsv(csv), experiment, projects)
  assert.equal(normalized[0].source, '示例,来源')
  experiment.observations = normalized
  const report = experimentReport(experiment, projects)
  assert.equal(report.versions[0].metrics.ctr, 0.01)
  assert.equal(report.versions[0].metrics.cvr, 0)
  assert.equal(report.versions[0].metrics.cpa, null)
  assert.equal(report.versions[1].hasData, false)
  for (const changes of [{ clicks: '' }, { conversions: '11' }, { impressions: '-1' }, { clicks: '1.5' }, { startDate: '2026-02-30' }, { version: 'X' }]) assert.throws(() => normalizeObservations([row('A', changes)], experiment, projects))
  assert.throws(() => parseCsv('version,version\nA,A'), /重复|缺失/)
  assert.throws(() => parseCsv(csv + '"'), /引号/)
})

test('imports replace exact intervals, reject overlap atomically, and stop comparison after media changes', () => {
  const { experiment, projects, variant } = experimentFixture()
  const first = normalizeObservations([row('A'), row('B')], experiment, projects)
  experiment.observations = mergeObservations([], first)
  const update = normalizeObservations([row('A', { spend: '30' })], experiment, projects)
  experiment.observations = mergeObservations(experiment.observations, update)
  assert.equal(experiment.observations.length, 2)
  assert.equal(experimentReport(experiment, projects).comparable, true)
  const before = structuredClone(experiment.observations)
  assert.throws(() => mergeObservations(before, normalizeObservations([row('A', { endDate: '2026-10-08' })], experiment, projects)), /重叠/)
  assert.deepEqual(before, experiment.observations)
  variant.render.finalVideo.url = '/media/new-final.mp4'
  assert.equal(experimentReport(experiment, projects).comparable, false)
  variant.render.finalVideo.stale = true
  assert.throws(() => normalizeObservations([row('B')], experiment, projects), /有效成片/)
  variant.render.finalVideo.stale = false; variant.render.shots.s0.backend = 'mock'
  assert.throws(() => normalizeObservations([row('B')], experiment, projects), /演示/)
})

test('unrelated library entries do not expire reviews, but selected asset/fact validity changes do', () => {
  const ctx = { project: fixture(), assetLib: { items: [{ id: 'logo', refImage: '/media/logo.png' }] }, factLib: { facts: [{ id: 'feature', status: 'confirmed' }] }, brandGuide: {}, compliance: {}, channel: {} }
  const before = reviewInputFingerprint(ctx)
  ctx.factLib.facts.push({ id: 'unrelated', status: 'draft' }); ctx.assetLib.items.push({ id: 'other', name: 'another' })
  assert.equal(reviewInputFingerprint(ctx), before)
  ctx.factLib.facts[0].validTo = '2000-01-01'
  assert.notEqual(reviewInputFingerprint(ctx), before)
})

test('expired campaign facts cannot guide generation, pass claim checks, or produce coupon cards', () => {
  const factLib = { facts: [{ id: 'offer', title: '旧活动', type: 'campaign', status: 'confirmed', validTo: '2000-01-01' }] }
  const project = { facts: ['offer'] }
  assert.equal(resolveFacts(project, factLib).confirmed.length, 0)
  const result = checkFactBinding({ requireFactBinding: { patterns: ['领券'], campaignOnlyPatterns: ['领券'] } }, factLib, project, { vo: '现在领券', factRefs: ['offer'] })
  assert.equal(result.severity, 'block')
  assert.throws(() => assertRenderable(factLib.facts[0]), /有效期/)
})

test('simple Chinese shot directions reach the actual generation prompt', () => {
  const shot = fixture().storyboard.shots[0]
  shot.actionCn = '上班族收起雨伞后上车'
  const compiled = compileShotRenderPrompt({ brandGuide: {}, picked: {}, globalContext: {}, shot, channel: null })
  assert.ok(compiled.prompt.includes(shot.actionCn))
})

test('video QA fails closed for mock/malformed checks and actually sends the media bytes', async () => {
  const project = fixture()
  const checks = ['visual', 'text', 'audio', 'facts', 'delivery'].map(id => ({ id, status: 'pass', evidence: '受控测试观察结果', timing: '0–3秒' }))
  for (const result of [{ source: 'mock', data: { checks } }, { source: 'llm', data: { checks: {} } }, { source: 'llm', data: { checks: checks.slice(0, 4) } }]) assert.notEqual(normalizeQuality(result, project).status, 'passed')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'creative-qa-'))
  try {
    const bytes = Buffer.from('0000ftypisomTEST-VIDEO-FIXTURE')
    await fs.writeFile(path.join(directory, 'final.mp4'), bytes)
    const report = await reviewFinalVideo({ project, brandGuide: {}, facts: { confirmed: [] } }, { directory, evaluate: async (_messages, _fallback, options) => {
      assert.deepEqual(Buffer.from(options.videoPart.inlineData.data, 'base64'), bytes)
      return { source: 'llm', data: { checks } }
    } })
    assert.equal(report.status, 'passed')
    const files = await deliveryFiles(project, directory)
    assert.ok(files.some(f => f.name.endsWith('-copy.txt')))
    assert.ok(files.some(f => f.name.endsWith('-delivery.json')))
    const zip = zipFiles(files)
    assert.equal(zip.readUInt32LE(0), 0x04034b50)
    project.render.finalVideo.stale = true
    await assert.rejects(reviewFinalVideo({ project }, { directory, evaluate: async () => ({}) }), /重新合成/)
  } finally { assert.ok(path.basename(directory).startsWith('creative-qa-')); await fs.rm(directory, { recursive: true, force: true }) }
  for (const url of ['/media/../secret', 'https://example.com/video', '/media/..', 'C:/secret']) assert.throws(() => mediaFile(url))
})
