import { randomUUID } from 'node:crypto'
import { getWorkspace, saveWorkspace, validateWorkspace } from './workspace.js'
import { getBrandGuide } from './store.js'
import { failure } from './experiments.js'

export async function listBrands() {
  const workspace = await getWorkspace()
  const initial = await getBrandGuide()
  return [{ id: 'hxz-ad-v1', name: initial.brandIdentity.productName }, ...(workspace.brands || []).filter(b => b.id !== 'hxz-ad-v1').map(b => ({ id: b.id, name: b.brandIdentity.productName }))]
}
export function registerBrandRoutes(app, wrap) {
  app.patch('/api/platform-policies/:id', wrap(async (req, res) => {
    const { getPlatformPolicies } = await import('./review-policy.js')
    const profile = (await getPlatformPolicies()).profiles.find(p => p.id === req.params.id)
    if (!profile) throw failure('平台不存在', 404)
    const { rules, sourceUrl, version } = req.body
    if (!Array.isArray(rules) || !rules.length || rules.length > 30 || rules.some(r => typeof r !== 'string' || !r.trim() || r.length > 500)) throw failure('请填写 1–30 条平台要求，每条最多 500 字')
    if (typeof sourceUrl !== 'string' || !/^https:\/\/[^\s]+$/.test(sourceUrl) || !String(version || '').trim()) throw failure('请填写 HTTPS 官方来源链接和规则版本')
    const updated = { ...profile, coverage: 'configured', version: String(version).slice(0, 80), missing: undefined, sources: [{ title: '用户录入的平台规则来源', url: sourceUrl, checkedAt: new Date().toISOString().slice(0, 10) }], rules: rules.map((label, i) => ({ id: `${profile.id}-custom-${i}`, label: label.trim(), sourceIndex: 0 })) }
    await saveWorkspace(previous => ({ platformPolicies: [...(previous.platformPolicies || []).filter(p => p.id !== profile.id), updated] }))
    res.json(updated)
  }))
  app.post('/api/brands', wrap(async (req, res) => {
    const identity = validateWorkspace({ brandIdentity: req.body.brandIdentity }, { categories: [] }, {}).brandIdentity
    if (!identity?.productName || !identity?.positioning) throw failure('请填写品牌名称和定位')
    const brand = { id: randomUUID(), name: identity.productName, brandIdentity: { productNameEn: '', category: '', primaryColor: '#FF3E7F', secondaryColor: '#FFE4EE', fontFamily: '系统字体', logoRules: [], primaryColorNote: '', ...identity }, productDisplayRules: [], copyRules: [], restrictions: [], reviewRules: [] }
    await saveWorkspace(previous => ({ brands: [...(previous.brands || []), brand] }))
    res.json(brand)
  }))
  app.patch('/api/brands/:id', wrap(async (req, res) => {
    const original = await getBrandGuide(req.params.id)
    const updates = {}
    if (req.body.brandIdentity) updates.brandIdentity = { ...original.brandIdentity, ...validateWorkspace({ brandIdentity: req.body.brandIdentity }, { categories: [] }, {}).brandIdentity }
    for (const key of ['productDisplayRules', 'copyRules', 'restrictions', 'reviewRules']) if (req.body[key] !== undefined) {
      const values = req.body[key]
      if (!Array.isArray(values) || values.length > 30 || values.some(v => typeof v !== 'string' || !v.trim() || v.length > 500)) throw failure('每类最多 30 条要求，每条 1–500 字')
      updates[key] = [...new Set(values.map(v => v.trim()))]
    }
    const brand = { id: req.params.id, brandIdentity: original.brandIdentity, productDisplayRules: original.productDisplayRules, copyRules: original.copyRules, restrictions: original.restrictions, reviewRules: original.reviewRules || [], ...updates }
    await saveWorkspace(previous => ({ brands: [...(previous.brands || []).filter(b => b.id !== brand.id), brand] }))
    res.json(brand)
  }))
}
