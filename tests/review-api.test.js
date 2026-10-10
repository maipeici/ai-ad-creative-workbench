import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'

test('review API persists requirements and fails closed without a model, using isolated runtime data', { timeout: 30000 }, async () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const temporaryRoot = path.join(root, '.local')
  await fs.mkdir(temporaryRoot, { recursive: true })
  const temporary = await fs.mkdtemp(path.join(temporaryRoot, 'review-test-'))
  let child
  try {
    for (const folder of ['src', 'config', 'data/seed']) {
      await fs.cp(path.join(root, folder), path.join(temporary, folder), { recursive: true })
    }
    await fs.copyFile(path.join(root, 'package.json'), path.join(temporary, 'package.json'))
    const reservation = net.createServer()
    reservation.listen(0, '127.0.0.1')
    await once(reservation, 'listening')
    const port = reservation.address().port
    await new Promise(resolve => reservation.close(resolve))
    child = spawn(process.execPath, ['src/server/index.js'], {
      cwd: temporary, windowsHide: true, stdio: 'ignore',
      env: {
        ...process.env, PORT: String(port), NODE_ENV: 'test',
        GCP_PROJECT_ID: '', GCP_CLIENT_EMAIL: '', GCP_PRIVATE_KEY: '',
        LLM_BASE_URL: '', LLM_API_KEY: '', LLM_MODEL: '',
        VERTEX_GEMINI_MODEL: '', VERTEX_IMAGE_MODEL: '', VERTEX_VEO_MODEL: '',
      },
    })
    const base = 'http://127.0.0.1:' + port
    let ready = false
    for (let attempt = 0; attempt < 80; attempt++) {
      try { if ((await fetch(base + '/api/projects')).ok) { ready = true; break } } catch {}
      if (child.exitCode !== null) throw new Error('Isolated server failed to start')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.ok(ready)
    async function request(route, method = 'GET', body) {
      const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
      return { status: response.status, data: await response.json() }
    }
    const created = await request('/api/projects', 'POST', { name: 'Isolated automatic review test' })
    const route = '/api/projects/' + created.data.id
    assert.equal(created.status, 200)
    const empty = await request(route + '/review', 'POST', {})
    assert.equal(empty.status, 400)
    const invalid = await request(route, 'PATCH', { review: { requirements: [] } })
    assert.equal(invalid.status, 400)
    await request(route, 'PATCH', { review: { requirements: ['CTA 清晰且具体'], approved: true, status: 'passed' } })
    const saved = await request(route)
    assert.deepEqual(saved.data.review.requirements, ['CTA 清晰且具体'])
    assert.equal(saved.data.review.approved, false)
    const shots = ['hook', 'cta'].map((role, index) => ({
      id: 'test-' + index, index: index + 1, role, durationSec: index ? 7 : 3,
      prompt: 'A person walking', vo: '打开花小猪叫车', subtitle: '', renderMode: 'ai',
      factRefs: [], uiRefs: [], overlayItems: [], personRefs: [], vehicleRefs: [], sceneRefs: [],
    }))
    await request(route, 'PATCH', { brief: { durationSec: 10 }, storyboard: { globalContext: {}, shots } })
    const run = await request(route + '/review', 'POST', { autoRepair: false })
    assert.equal(run.status, 200)
    assert.equal(run.data.project.review.approved, false)
    assert.equal(run.data.project.review.status, 'needs-input')
    assert.equal(run.data.project.review.source, 'mock')
    assert.equal(run.data.project.review.results[0].status, 'needs-input')
    const persisted = await request(route)
    assert.equal(persisted.data.review.checkedAt, run.data.project.review.checkedAt)
    const render = await request(route + '/render/shots/test-0', 'POST', {})
    assert.equal(render.status, 400)
    assert.match(render.data.error, /自动审核/)
    await request(route, 'PATCH', { brief: { goal: '变更后的目标' } })
    assert.equal((await request(route)).data.review.status, 'stale')
  } finally {
    if (child && child.exitCode === null) { child.kill(); await once(child, 'exit') }
    const resolved = path.resolve(temporary)
    assert.ok(resolved.startsWith(path.resolve(temporaryRoot) + path.sep) && path.basename(resolved).startsWith('review-test-'))
    await fs.rm(resolved, { recursive: true, force: true })
  }
})
