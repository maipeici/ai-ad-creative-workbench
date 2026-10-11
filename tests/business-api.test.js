import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { once } from 'node:events'

test('isolated business workflow: inherited brief → locked A/B → result import → next task and ZIP', { timeout: 30000 }, async () => {
  const root = fileURLToPath(new URL('..', import.meta.url)), local = path.join(root, '.local')
  await fs.mkdir(local, { recursive: true })
  const directory = await fs.mkdtemp(path.join(local, 'business-test-'))
  let child
  try {
    for (const folder of ['src', 'config', 'data/seed']) await fs.cp(path.join(root, folder), path.join(directory, folder), { recursive: true })
    await fs.copyFile(path.join(root, 'package.json'), path.join(directory, 'package.json'))
    const reservation = net.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening')
    const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve))
    child = spawn(process.execPath, ['src/server/index.js'], { cwd: directory, windowsHide: true, stdio: 'ignore', env: { ...process.env, PORT: String(port), NODE_ENV: 'test', GCP_PROJECT_ID: '', GCP_CLIENT_EMAIL: '', GCP_PRIVATE_KEY: '', LLM_BASE_URL: '', LLM_API_KEY: '', LLM_MODEL: '', VERTEX_GEMINI_MODEL: '', VERTEX_IMAGE_MODEL: '', VERTEX_VEO_MODEL: '', VIDEO_MODE: 'mock' } })
    const base = `http://127.0.0.1:${port}`
    for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/api/projects')).ok) break } catch {} if (child.exitCode !== null) throw new Error('Isolated server failed to start'); await new Promise(resolve => setTimeout(resolve, 100)) }
    async function request(route, method = 'GET', body, status = 200) {
      const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
      const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data)); return data
    }
    const meta = await request('/api/meta')
    assert.deepEqual(meta.phases.slice(4).map(p=>p.name), ['视频制作','自动审核','投放迭代'])
    const defaultFact = meta.facts.facts.find(f => f.status === 'confirmed' && !f.validTo && !f.validFrom)
    await request('/api/workspace', 'PATCH', { defaults: { assets: {}, facts: defaultFact ? [defaultFact.id] : [] } })
    const source = await request('/api/projects', 'POST', { name: 'Isolated A/B test, not real performance' })
    assert.equal(source.phase, 1); assert.equal(source.brief.conversionEvent, 'download')
    assert.deepEqual(source.facts, defaultFact ? [defaultFact.id] : [])
    const route = '/api/projects/' + source.id
    const shots = ['hook', 'cta'].map((role, i) => ({ id: 's' + i, index: i + 1, role, durationSec: 3, prompt: 'A commuter', vo: '出发了', subtitle: '', personRefs: [], uiRefs: [], factRefs: [], sceneRefs: [], vehicleRefs: [] }))
    await fs.mkdir(path.join(directory, 'data/runtime/media'), { recursive: true })
    await fs.writeFile(path.join(directory, 'data/runtime/media/fixture.mp4'), '0000ftypisomCONTROLLED-TEST-FIXTURE')
    await request(route, 'PATCH', { storyboard: { globalContext: {}, shots }, render: { shots: { s0: { url: '/media/fixture.mp4', backend: 'manual' }, s1: { url: '/media/fixture.mp4', backend: 'manual' } }, finalVideo: { url: '/media/fixture.mp4' } } })
    const created = await request(route + '/experiments', 'POST', { variable: 'hook', primaryMetric: 'ctr', hypothesis: '测试开头表达' })
    const experimentRoute = route + '/experiments/' + created.experiment.id
    const baselineId = created.experiment.versions[0].projectId
    const b = await request(experimentRoute + '/versions', 'POST', { changes: { vo: '下班赶车去' } })
    const variantRoute = '/api/projects/' + b.version.id
    assert.equal(b.version.render.shots.s1.url, '/media/fixture.mp4')
    assert.equal(b.version.render.shots.s0, undefined)
    assert.equal((await request('/api/projects/' + baselineId))._experimentRenderLocked, true)
    await request('/api/projects/' + baselineId + '/render/assemble', 'POST', {}, 409)
    await request(variantRoute + '/render/shots/s1', 'POST', { force: true }, 409)
    await request(variantRoute, 'PATCH', { brief: { audience: 'other' } }, 409)
    await request(variantRoute, 'PATCH', { render: { shots: { s1: { url: '/media/other.mp4' } } } }, 409)
    await request(variantRoute, 'PATCH', { render: { shots: { s0: { url: '/media/fixture.mp4', backend: 'manual' } }, finalVideo: { url: '/media/fixture.mp4' } } })
    const csv = 'version,startDate,endDate,impressions,clicks,conversions,spend,source\nA,2026-10-01,2026-10-02,1000,10,0,20,test-fixture\nB,2026-10-01,2026-10-02,1000,20,1,30,test-fixture'
    const results = await request(experimentRoute + '/results', 'POST', { content: csv })
    assert.equal(results.comparable, true); assert.equal(results.versions[1].metrics.cpa, 30)
    await request(experimentRoute + '/results', 'POST', { content: csv })
    assert.equal((await request('/api/experiments'))[0].observations.length, 2)
    await request(experimentRoute, 'PATCH', { conclusion: '测试夹具，不可用于业务判断', nextAction: '下一轮测试行动引导' })
    const next = await request(experimentRoute + '/next-task', 'POST', {})
    assert.match(next.brief.notes, /下一轮测试行动引导/); assert.equal(next.storyboard, null); assert.equal(next.experiments, undefined)
    const zip = await fetch(base + experimentRoute + '/delivery.zip')
    assert.equal(zip.status, 409, 'unreviewed experiment videos cannot be packaged')
    const changed = structuredClone(b.version.storyboard); changed.shots[0].vo = '新镜头内容'
    const patched = await request(variantRoute, 'PATCH', { storyboard: changed })
    assert.equal(patched._impact, null, 'Editing one shot must not report unrelated global changes')
    const stale = await request(variantRoute)
    assert.equal(stale.render.shots.s0.stale, true); assert.equal(stale.render.finalVideo.stale, true)
    await request(experimentRoute + '/results', 'POST', { content: csv }, 400)
    await request(variantRoute + '/delivery.zip', 'GET', undefined, 409)
    await request(variantRoute + '/quality-review', 'POST', {}, 409)
    await request(route, 'DELETE')
    await request(variantRoute, 'GET', undefined, 404)

    // New batch model: multiple video records live inside one visible project.
    const batchProject = await request('/api/projects', 'POST', { name: '12-video isolated batch' })
    const batchRoute = '/api/projects/' + batchProject.id
    const concepts = ['first', 'second', 'third'].map(id => ({ id, title: id, coreIdea: '出行', hook: '人物出行痛点', beats: [] }))
    await request(batchRoute, 'PATCH', { concepts, selectedConceptId: 'first', storyboard: { globalContext: {}, shots } })
    await request(batchRoute + '/batch/creatives', 'POST', { conceptIds: ['first', 'second'], versionCount: 12 }, 400)
    const added = await request(batchRoute + '/batch/creatives', 'POST', { versionCount: 12, allowedChanges: ['performance', 'camera', 'wording'], hookStrategy: '人物出行痛点' })
    assert.equal(added.batch.items.length, 12)
    assert.equal(new Set(added.batch.items.map(i => i.conceptId)).size, 1)
    await request(batchRoute, 'PATCH', { selectedConceptId: 'second' }, 409)
    await request(batchRoute, 'PATCH', { versionPlan: null }, 400)
    assert.equal((await request('/api/projects')).filter(p => p.name === batchProject.name).length, 1)
    const [first, second] = added.batch.items.slice(1, 3)
    await Promise.all([request('/api/projects/' + first.id, 'PATCH', { creativeInstruction: '开头版本甲' }), request('/api/projects/' + second.id, 'PATCH', { creativeInstruction: '开头版本乙' })])
    assert.equal((await request('/api/projects/' + first.id)).creativeInstruction, '开头版本甲')
    assert.equal((await request('/api/projects/' + second.id)).creativeInstruction, '开头版本乙')
    await request('/api/projects/' + first.id, 'PATCH', { brief: { channel: 'wechat-channels' } }, 409)
    await request(batchRoute, 'PATCH', { brief: { channel: 'wechat-channels' } })
    assert.equal((await request('/api/projects/' + first.id)).brief.channel, 'wechat-channels')
    assert.ok((await request('/api/projects/' + first.id)).reviewPolicy.rules.some(r => r.requiredInput))
    await request('/api/platform-policies/wechat-channels', 'PATCH', { rules: ['测试规则：不作无依据承诺'], sourceUrl: 'https://e.qq.com/', version: 'isolated-fixture' })
    assert.ok(!(await request('/api/projects/' + first.id)).reviewPolicy.rules.some(r => r.requiredInput))
    const brand = await request('/api/brands', 'POST', { brandIdentity: { productName: '测试品牌', positioning: '测试定位', primaryColor: '#123456' } })
    await request(batchRoute, 'PATCH', { brandGuideId: brand.id })
    assert.equal((await request('/api/meta?brandId=' + brand.id)).brandGuide.brandIdentity.productName, '测试品牌')
    await request('/api/brands/' + brand.id, 'PATCH', { reviewRules: ['不出现竞品标志'] })
    assert.ok((await request('/api/projects/' + first.id)).reviewPolicy.rules.some(r => r.label === '不出现竞品标志'))
    const job = await request(batchRoute + '/batch/run', 'POST', { ids: [first.id, second.id], stage: 'storyboard' })
    assert.equal(job.status, 'running')
    let batch
    for (let i = 0; i < 60; i++) { batch = await request(batchRoute + '/batch'); if (batch.job.status !== 'running') break; await new Promise(resolve => setTimeout(resolve, 100)) }
    assert.equal(batch.job.status, 'attention', 'mock storyboard must not be reported as real batch generation')
    assert.equal(batch.job.items.filter(i => i.status === 'attention').length, 2, 'one item failure must not abort siblings')
    const untouched = await request(batchRoute)
    assert.deepEqual(untouched.storyboard.shots, shots, 'child storyboard writes must not replace the base script')
    assert.equal(untouched.creatives.length, 11)
    const regenerated = await request('/api/projects/' + first.id + '/storyboard/shots/s0/regenerate', 'POST', { instruction: '保持创意，用更近的景别' })
    assert.deepEqual(regenerated.project.storyboard.shots.map(s => [s.id, s.role, s.durationSec]), shots.map(s => [s.id, s.role, s.durationSec]))
    assert.equal(regenerated.project.storyboard.shots[1].vo, shots[1].vo, 'shot regeneration preserves the fixed CTA')
    // Material tests reuse existing batch items and export several independent films.
    for (const item of [first, second]) {
      const itemShots = structuredClone(shots)
      if (item.id === second.id) itemShots[0].vo = '另一个开头'
      await request('/api/projects/' + item.id, 'PATCH', { storyboard: { globalContext: {}, shots: itemShots, source: 'manual' }, render: { shots: { s0: { url: '/media/fixture.mp4', backend: 'manual' }, s1: { url: '/media/fixture.mp4', backend: 'manual' } }, finalVideo: { url: '/media/fixture.mp4' } } })
      await request('/api/projects/' + item.id, 'PATCH', { storyboard: { shots: itemShots.map(s => ({ ...s, durationSec: 8 })) } }, 409)
    }
    const compared = await request(batchRoute + '/experiments', 'POST', { mode: 'comparison', creativeIds: [first.id, second.id], primaryMetric: 'ctr', hypothesis: '比较已有素材' })
    assert.deepEqual(compared.experiment.versions.map(v => v.projectId), [first.id, second.id])
    assert.equal((await request(batchRoute)).creatives.length, 11, 'selecting existing films must not duplicate records')
    const imported = await request(batchRoute + '/experiments/' + compared.experiment.id + '/results', 'POST', { content: csv })
    assert.equal(imported.comparable, true)
    const controlled = await request(batchRoute + '/experiments', 'POST', { mode: 'single-variable', creativeIds: [first.id], variable: 'hook', primaryMetric: 'ctr', hypothesis: '只改开头' })
    const controlledB = await request(batchRoute + '/experiments/' + controlled.experiment.id + '/versions', 'POST', { changes: { vo: '新的实验开头' } })
    assert.equal(controlledB.version.batchId, batchProject.id)
    assert.equal(controlledB.version.render.shots.s1.url, '/media/fixture.mp4')
    assert.equal(controlledB.version.render.shots.s0, undefined)
    const tracking=await request(batchRoute+'/experiments','POST',{mode:'tracking',creativeIds:[first.id],primaryMetric:'ctr',hypothesis:'记录效果并迭代'})
    const trackingRoute=batchRoute+'/experiments/'+tracking.experiment.id
    await request(trackingRoute+'/results','POST',{content:csv.split('\n').slice(0,2).join('\n')})
    const iteration=await request(trackingRoute+'/iterate','POST',{projectId:first.id,variable:'hook',instruction:'验证开头表达',changes:{vo:'基于效果的新开头'}})
    assert.equal(iteration.version.iteration.parentProjectId,first.id)
    assert.equal(iteration.version.render.shots.s1.url,'/media/fixture.mp4')
    assert.equal(iteration.version.render.shots.s0,undefined)
    assert.equal((await request('/api/projects/'+iteration.version.id)).iteration.sourceExperimentId,tracking.experiment.id)
    const tracked=(await request('/api/experiments')).find(e=>e.id===tracking.experiment.id)
    assert.equal(tracked.iterations.length,1)
    assert.ok(tracked.insights.length)
    const batchZip = await fetch(base + batchRoute + '/batch/delivery.zip?ids=' + first.id + ',' + second.id)
    assert.equal(batchZip.status, 409, 'unreviewed batch videos cannot be packaged')
    await request(batchRoute, 'DELETE')
    await request('/api/projects/' + first.id, 'GET', undefined, 404)
    child.kill(); await once(child, 'exit'); child = null
    const store = await import(pathToFileURL(path.join(directory, 'src/server/store.js')).href)
    const localParent = structuredClone(added); localParent.id = 'interleaved-parent'
    await store.upsertProject(localParent)
    const loadedBeforeChildSave = await store.getProject(localParent.id)
    const changedChild = await store.getProject(first.id)
    changedChild.creativeInstruction = 'new child content saved after parent was loaded'
    await store.upsertProject(changedChild)
    loadedBeforeChildSave.name = 'Renamed without losing child content'
    await store.upsertProject(loadedBeforeChildSave)
    assert.equal((await store.getProject(first.id)).creativeInstruction, changedChild.creativeInstruction)
  } finally {
    if (child && child.exitCode === null) { child.kill(); await once(child, 'exit') }
    const resolved = path.resolve(directory)
    assert.ok(resolved.startsWith(path.resolve(local) + path.sep) && path.basename(resolved).startsWith('business-test-'))
    await fs.rm(resolved, { recursive: true, force: true })
  }
})
