import test from 'node:test'
import assert from 'node:assert/strict'
import { registerInspirationRoutes } from '../src/server/inspiration-routes.js'

const referenceId = 'demo-douyin-commute'
const analysisData = {
  summary: '场景引出产品操作。',
  segments: [{ timing: '0–3秒', role: '钩子', evidence: '晚高峰拥挤的人群', explanation: '从出行场景进入。' }],
  suggestions: [{ id: 'hook', label: '以场景开头', pattern: '场景先行', adaptation: '结合当前品牌改写。' }],
  limitations: '基于示例脚本，未观看视频。',
}
const conceptData = {
  title: '新的通勤创意', coreIdea: '呈现下班出行场景', audienceFit: '通勤人群', hook: '走出写字楼',
  painPoint: '规划返程', sellingPoint: '查看出行信息', productAppearance: '官方界面叠加',
  ctaText: '打开应用', factRefs: [], beats: [{ role: 'hook', name: '开场', description: '下班后走出写字楼', approxSec: 15 }],
}

function fixture() {
  let project = { id: 'test-project', phase: 6, brief: { channel: 'oceanengine-douyin', durationSec: 15 },
    concepts: [{ id: 'original' }], selectedConceptId: 'original', storyboard: { shots: [{ id: 'shot-1' }] },
    render: { finalVideo: '/media/existing.mp4' } }
  const handlers = new Map(), items = []
  let modelHook = () => {}
  const app = Object.fromEntries(['get', 'post', 'patch'].map(method => [method, (url, handler) => handlers.set(method + ' ' + url, handler)]))
  registerInspirationRoutes(app, {
    wrap: fn => fn,
    referenceStore: { read: async () => items, import: async imported => { items.push(...imported); return imported } },
    loadContext: async () => ({ project: structuredClone(project), facts: { confirmed: [], unusable: [] },
      brandGuide: { brandIdentity: { category: '出行服务' }, format: {}, audienceOptions: [], sceneOptions: [] },
      compliance: { rules: [] }, picked: {}, assetLib: { categories: [] }, channel: { name: '抖音' } }),
    saveProject: async value => { project = value },
    evaluate: async messages => {
      modelHook()
      return { source: 'gemini', data: messages[0].content.includes('脚本拆解 Agent') ? analysisData : { concepts: [conceptData] } }
    },
  })
  return {
    async call(method, path, body = {}, query = {}) {
      let result
      await handlers.get(method + ' ' + path)({ params: { id: 'test-project', referenceId }, body, query }, { json: value => { result = value } })
      return result
    },
    read: () => structuredClone(project),
    changeDuringModel: () => { modelHook = () => { project.brief.durationSec = 20 } },
  }
}

test('reference routes keep demos separate and reject an invalid batch before saving', async () => {
  const f = fixture()
  await assert.rejects(f.call('post', '/api/inspirations/import', { format: 'json', content: JSON.stringify([
    { title: '有效参考', platform: 'douyin', industry: 'mobility' }, { title: '缺少平台' },
  ]) }), /第 2 条/)
  const library = await f.call('get', '/api/inspirations')
  assert.equal(library.importedCount, 0)
  assert.equal(library.items.length, 0)
  const demos = await f.call('get', '/api/inspirations', {}, { mode: 'demo', platform: 'douyin' })
  assert.equal(demos.items.length, 2)
  assert.ok(demos.items.every(r => r.isDemo))
})

test('applying a reference appends a concept while preserving selection, storyboard and final video', async () => {
  const f = fixture(), before = f.read()
  await f.call('post', '/api/projects/:id/inspirations/:referenceId/analyze')
  const applied = await f.call('post', '/api/projects/:id/inspirations/:referenceId/apply', { suggestionIds: ['hook'] })
  assert.equal(applied.project.concepts.length, 2)
  assert.equal(applied.project.selectedConceptId, before.selectedConceptId)
  assert.deepEqual(applied.project.storyboard, before.storyboard)
  assert.deepEqual(applied.project.render, before.render)
  assert.equal(applied.project.phase, 6)
  assert.equal(applied.concept.inspiration.referenceId, referenceId)
  assert.equal(applied.concept.inspiration.isDemo, true)
})

test('a changed brief during the model request cannot save a stale analysis', async () => {
  const f = fixture()
  f.changeDuringModel()
  await assert.rejects(f.call('post', '/api/projects/:id/inspirations/:referenceId/analyze'), e => e.status === 409)
  assert.equal(f.read().inspirationAnalyses, undefined)
  assert.equal(f.read().brief.durationSec, 20)
})

test('one-click import selects the reference version and retains original concept and finished work', async () => {
  const f=fixture(),before=f.read()
  await f.call('post','/api/projects/:id/inspirations/:referenceId/analyze')
  const result=await f.call('post','/api/projects/:id/inspirations/:referenceId/apply',{suggestionIds:['hook'],targetConceptId:'original',selectAfterApply:true})
  assert.equal(result.project.selectedConceptId,result.concept.id)
  assert.equal(result.concept.inspiration.adaptedFromConceptId,'original')
  assert.equal(result.concept.inspiration.guidance[0].pattern,'场景先行')
  assert.deepEqual(result.project.concepts[0],before.concepts[0])
  assert.deepEqual(result.project.storyboard,before.storyboard)
  assert.deepEqual(result.project.render,before.render)
  await assert.rejects(f.call('post','/api/projects/:id/inspirations/:referenceId/apply',{suggestionIds:['hook'],targetConceptId:'missing'}),e=>e.status===409)
})
