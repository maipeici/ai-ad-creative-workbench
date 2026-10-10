import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initializeRuntimeData } from '../src/server/runtime-data.js'

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-data-'))
  t.after(() => {
    const resolved = path.resolve(root)
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep))
    assert.ok(path.basename(resolved).startsWith('workbench-data-'))
    fs.rmSync(resolved, { recursive: true, force: true })
  })
  const seedDir = path.join(root, 'seed')
  const runtimeDir = path.join(root, 'runtime')
  fs.mkdirSync(seedDir)
  fs.writeFileSync(path.join(seedDir, 'assets.json'), JSON.stringify({ items: [{ id: 'seed-asset' }] }))
  fs.writeFileSync(path.join(seedDir, 'product-facts.json'), JSON.stringify({ facts: [{ id: 'seed-fact' }] }))
  return { seedDir, runtimeDir }
}

test('a new installation receives valid defaults and an empty project list', t => {
  const dirs = fixture(t)
  initializeRuntimeData(dirs)
  for (const name of ['assets.json', 'product-facts.json']) {
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(dirs.runtimeDir, name), 'utf8')),
      JSON.parse(fs.readFileSync(path.join(dirs.seedDir, name), 'utf8')),
    )
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dirs.runtimeDir, 'projects.json'), 'utf8')), [])
  assert.ok(fs.statSync(path.join(dirs.runtimeDir, 'media')).isDirectory())
})

test('restarting after a seed update preserves projects, edits and media byte for byte', t => {
  const dirs = fixture(t)
  initializeRuntimeData(dirs)
  const localFiles = new Map([
    ['projects.json', '[{"id":"existing-project","phase":6}]\n'],
    ['assets.json', '{"items":[{"id":"user-upload"}]}\n'],
    ['product-facts.json', '{"facts":[{"id":"user-fact","status":"confirmed"}]}\n'],
    ['media/example.mp4', 'existing-media-fixture'],
  ])
  for (const [name, data] of localFiles) fs.writeFileSync(path.join(dirs.runtimeDir, name), data)
  for (const name of ['assets.json', 'product-facts.json']) fs.writeFileSync(path.join(dirs.seedDir, name), '{}')
  initializeRuntimeData(dirs)
  for (const [name, data] of localFiles) assert.equal(fs.readFileSync(path.join(dirs.runtimeDir, name), 'utf8'), data)
})

test('a missing default file fails clearly instead of silently replacing it with empty data', t => {
  const dirs = fixture(t)
  assert.throws(() => initializeRuntimeData({ ...dirs, seedDir: path.join(dirs.seedDir, 'missing') }), { code: 'ENOENT' })
})