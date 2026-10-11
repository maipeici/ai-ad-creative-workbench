import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
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
    assert.equal(meta.phases[4].name, '脚本预检')
    const defaultFact = meta.facts.facts.find(f => f.status === 'confirmed' && !f.validTo && !f.validFrom)
    await request('/api/workspace', 'PATCH', { defaults: { assets: {}, facts: defaultFact ? [defaultFact.id] : [] } })
    const source = await request('/api/projects', 'POST', { name: 'Isolated A/B test, not real performance' })
    assert.equal(source.phase, 2); assert.equal(source.brief.conversionEvent, 'download')
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
    assert.equal(zip.status, 200); assert.match(zip.headers.get('Content-Type'), /application\/zip/)
    assert.equal(Buffer.from(await zip.arrayBuffer()).readUInt32LE(0), 0x04034b50)
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
  } finally {
    if (child && child.exitCode === null) { child.kill(); await once(child, 'exit') }
    const resolved = path.resolve(directory)
    assert.ok(resolved.startsWith(path.resolve(local) + path.sep) && path.basename(resolved).startsWith('business-test-'))
    await fs.rm(resolved, { recursive: true, force: true })
  }
})
