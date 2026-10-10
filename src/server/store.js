import fsp from 'node:fs/promises'
import path from 'node:path'
import { DATA_DIR, SEED_DIR, BUSINESS_DIR } from './config.js'
import { initializeRuntimeData } from './runtime-data.js'

const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json')
const ASSETS_FILE = path.join(DATA_DIR, 'assets.json')
const BRAND_FILE = path.join(BUSINESS_DIR, 'brand-guide.json')
const FACTS_FILE = path.join(DATA_DIR, 'product-facts.json')
const CHANNELS_FILE = path.join(BUSINESS_DIR, 'channels.json')
const COMPLIANCE_FILE = path.join(BUSINESS_DIR, 'compliance.json')

initializeRuntimeData({ runtimeDir: DATA_DIR, seedDir: SEED_DIR })

let writeQueue = Promise.resolve()

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJsonQueued(file, data) {
  const operation = writeQueue.then(async () => {
    const temporary = file + '.tmp'
    await fsp.writeFile(temporary, JSON.stringify(data, null, 2), 'utf8')
    await fsp.rename(temporary, file)
  })
  // A failed save must reach the caller, while later saves can still proceed.
  writeQueue = operation.catch(() => {})
  return operation
}

export async function getBrandGuide() {
  return readJson(BRAND_FILE, {})
}

export async function getChannels() {
  return readJson(CHANNELS_FILE, { channels: [] })
}

export async function getCompliance() {
  return readJson(COMPLIANCE_FILE, { rules: [] })
}

export async function getAssets() {
  return readJson(ASSETS_FILE, { categories: [], items: [] })
}

export async function saveAssets(assets) {
  await writeJsonQueued(ASSETS_FILE, assets)
  return assets
}

export async function getFacts() {
  return readJson(FACTS_FILE, { facts: [], factTypes: [], statusTypes: [] })
}

export async function saveFacts(facts) {
  await writeJsonQueued(FACTS_FILE, facts)
  return facts
}

export async function listProjects() {
  const all = await readJson(PROJECTS_FILE, [])
  return all
    .map((p) => ({
      id: p.id,
      name: p.name,
      phase: p.phase,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      channel: p.brief?.channel,
      audience: p.brief?.audience,
      scene: p.brief?.scene,
      durationSec: p.brief?.durationSec,
      shotCount: p.storyboard?.shots?.length || 0,
      variantCount: p.variants?.length || 0,
      approved: Boolean(p.review?.approved),
      finalVideo: p.render?.finalVideo?.url || null,
      cover: p.render?.cover || null,
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export async function getProject(id) {
  const all = await readJson(PROJECTS_FILE, [])
  return all.find((p) => p.id === id) || null
}

export async function upsertProject(project) {
  const all = await readJson(PROJECTS_FILE, [])
  project.updatedAt = new Date().toISOString()
  const idx = all.findIndex((p) => p.id === project.id)
  if (idx >= 0) all[idx] = project
  else all.push(project)
  await writeJsonQueued(PROJECTS_FILE, all)
  return project
}

export async function deleteProject(id) {
  const all = await readJson(PROJECTS_FILE, [])
  await writeJsonQueued(
    PROJECTS_FILE,
    all.filter((p) => p.id !== id),
  )
}

/** 深合并 patch（数组整体替换） */
export function deepMerge(target, patch) {
  if (Array.isArray(patch) || patch === null || typeof patch !== 'object') return patch
  const out = { ...(target && typeof target === 'object' ? target : {}) }
  for (const [k, v] of Object.entries(patch)) {
    out[k] = deepMerge(out[k], v)
  }
  return out
}
