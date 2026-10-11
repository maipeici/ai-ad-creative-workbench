import fsp from 'node:fs/promises'
import path from 'node:path'
import { DATA_DIR, SEED_DIR, BUSINESS_DIR } from './config.js'
import { invalidateReview, reviewProjectFingerprint } from './review-state.js'
import { initializeRuntimeData } from './runtime-data.js'
import { getWorkspace } from './workspace.js'
import { assertExperimentLock, assertFrozenMedia, baselineFrozen, fingerprint } from './experiments.js'
import { qualityFingerprint, compositionFingerprint } from './delivery.js'

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
  const [brand, visual, workspace] = await Promise.all([readJson(BRAND_FILE, {}), getVisualDesign(), getWorkspace()])
  return { ...brand, ...visual, brandIdentity: { ...brand.brandIdentity, ...workspace.brandIdentity }, negativePromptLibrary: { ...brand.negativePromptLibrary, ...visual.negativePromptLibrary } }
}

export async function getVisualDesign() {
  return readJson(path.join(BUSINESS_DIR, 'visual-design.json'), {})
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
      experimentLink: p.experimentLink || null,
      experimentCount: p.experiments?.length || 0,
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export async function getProject(id) {
  const all = await readJson(PROJECTS_FILE, [])
  const project = all.find((p) => p.id === id)
  return project ? { ...project, _experimentRenderLocked: baselineFrozen(project, all) } : null
}

export async function upsertProject(project) {
  await upsertProjects([project])
  return project
}

export const getAllProjects = () => readJson(PROJECTS_FILE, [])
export function upsertProjects(projects) {
  const operation = writeQueue.then(async () => {
    const all = await getAllProjects()
    for (const project of projects) {
      const idx = all.findIndex(p => p.id === project.id)
      if (idx >= 0) {
        assertFrozenMedia(project, all[idx], all)
        const previous = all[idx]
        if (project.render?.finalVideo && project.render.finalVideo.url === previous.render?.finalVideo?.url && compositionFingerprint(previous) !== compositionFingerprint(project)) project.render.finalVideo.stale = true
        for (const shot of project.storyboard?.shots || []) {
          const old = previous.storyboard?.shots?.find(s => s.id === shot.id)
          const content = s => { const { preview, approved, ...rest } = s; return rest }
          const changed = old && (fingerprint(content(old)) !== fingerprint(content(shot)) || fingerprint(previous.storyboard.globalContext) !== fingerprint(project.storyboard.globalContext))
          if (changed && project.render?.shots?.[shot.id]?.url === previous.render?.shots?.[shot.id]?.url && project.render?.shots?.[shot.id]) project.render.shots[shot.id].stale = true
        }
      }
      assertExperimentLock(project, idx >= 0 ? all[idx] : project)
      delete project._experimentRenderLocked
      if (project.render?.finalVideo?.inputFingerprint && project.render.finalVideo.inputFingerprint !== compositionFingerprint(project)) project.render.finalVideo.stale = true
      if (project.render?.qualityReview && project.render.qualityReview.inputFingerprint !== qualityFingerprint(project)) project.render.qualityReview.status = 'stale'
      if (project.review?.checkedAt && project.review.projectFingerprint !== reviewProjectFingerprint(project)) invalidateReview(project)
      project.updatedAt = new Date().toISOString()
      if (idx >= 0) all[idx] = project
      else all.push(project)
    }
    await fsp.writeFile(PROJECTS_FILE + '.tmp', JSON.stringify(all, null, 2))
    await fsp.rename(PROJECTS_FILE + '.tmp', PROJECTS_FILE)
  })
  writeQueue = operation.catch(() => {})
  return operation
}

export async function deleteProject(id) {
  const operation = writeQueue.then(async () => {
    const all = await getAllProjects()
    if (all.find(p => p.id === id)?.experimentLink) throw Object.assign(new Error('实验版本需随源任务一起管理，不能单独删除'), { status: 409 })
    await fsp.writeFile(PROJECTS_FILE + '.tmp', JSON.stringify(all.filter(p => p.id !== id && p.experimentLink?.parentId !== id), null, 2))
    await fsp.rename(PROJECTS_FILE + '.tmp', PROJECTS_FILE)
  })
  writeQueue = operation.catch(() => {})
  await operation
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
