import fs from 'node:fs/promises'
import path from 'node:path'
import { DATA_DIR } from './config.js'

const file = path.join(DATA_DIR, 'workspace.json')
let queue = Promise.resolve()
export async function getWorkspace() {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return { defaults: { assets: {}, facts: [] }, brandIdentity: {} }; throw error }
}
export function saveWorkspace(changes) {
  const next = queue.then(async () => {
    const previous = await getWorkspace()
    const update = typeof changes === 'function' ? await changes(previous) : changes
    const workspace = { ...previous, ...update, brandIdentity: { ...previous.brandIdentity, ...update.brandIdentity }, updatedAt: new Date().toISOString() }
    await fs.mkdir(DATA_DIR, { recursive: true })
    await fs.writeFile(file + '.tmp', JSON.stringify(workspace, null, 2))
    await fs.rename(file + '.tmp', file)
    return workspace
  })
  queue = next.catch(() => {})
  return next
}
export function usableFact(fact, today = new Date().toISOString().slice(0, 10)) {
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
  return fact.status === 'confirmed' && (!fact.validFrom || validDate(fact.validFrom) && fact.validFrom <= today) && (!fact.validTo || validDate(fact.validTo) && fact.validTo >= today)
}
export function inheritResources(project, workspace, assets, facts) {
  const defaults = workspace.defaults || {}
  project.brandGuideId = defaults.brandGuideId || project.brandGuideId
  const allowed = new Map(assets.items.map(asset => [asset.id, asset]))
  for (const category of assets.categories) {
    project.assets[category.id] = (defaults.assets?.[category.id] || []).filter(id => allowed.get(id)?.category === category.id)
  }
  project.facts = (defaults.facts || []).filter(id => facts.facts.some(f => f.id === id && usableFact(f)))
  project.resourcesInheritedAt = workspace.updatedAt || null
  return project
}
export function validateWorkspace(input, assets, facts) {
  const changes = {}
  if (input.defaults) {
    const defaults = input.defaults
    if (!defaults.assets || !Array.isArray(defaults.facts)) throw new Error('默认资料格式不完整')
    changes.defaults = { assets: {}, facts: [], ...(defaults.brandGuideId ? { brandGuideId: String(defaults.brandGuideId) } : {}) }
    for (const category of assets.categories) {
      const ids = defaults.assets[category.id] || []
      if (!Array.isArray(ids) || ids.some(id => !assets.items.some(a => a.id === id && a.category === category.id))) throw new Error('默认素材不存在或分类不匹配')
      changes.defaults.assets[category.id] = [...new Set(ids)]
    }
    if (defaults.facts.some(id => !facts.facts.some(f => f.id === id && usableFact(f)))) throw new Error('默认事实必须已确认且在有效期内')
    changes.defaults.facts = [...new Set(defaults.facts)]
  }
  if (input.brandIdentity) {
    changes.brandIdentity = {}
    for (const key of ['productName', 'productNameEn', 'category', 'positioning', 'primaryColor', 'secondaryColor']) {
      if (input.brandIdentity[key] === undefined) continue
      const value = input.brandIdentity[key]
      if (typeof value !== 'string' || !value.trim() || value.length > 500) throw new Error('品牌信息不能为空，且不能超过 500 字')
      if (key.endsWith('Color') && !/^#[0-9a-f]{6}$/i.test(value)) throw new Error('品牌色须为六位十六进制颜色')
      changes.brandIdentity[key] = value.trim()
    }
  }
  return changes
}
