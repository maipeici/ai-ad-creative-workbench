import express from 'express'
import cors from 'cors'
import multer from 'multer'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { nanoid } from 'nanoid'

import { config, providerStatus, resolvedVideoMode, MEDIA_DIR, DIST_DIR } from './config.js'
import {
  getBrandGuide,
  getVisualDesign,
  getChannels,
  getCompliance,
  getAssets,
  saveAssets,
  getFacts,
  saveFacts,
  listProjects,
  getProject,
  upsertProject,
  deleteProject,
  deepMerge,
} from './store.js'
import {
  resolveAssets,
  resolveFacts,
  missingOfficialAssets,
  conceptMessages,
  storyboardMessages,
  shotRegenMessages,
  variantMessages,
  compileShotRenderPrompt,
  globalContextBlock,
} from './prompts.js'
import { validateStoryboard, analyzeImpact, scanCompliance } from './validate.js'
import { autoFix } from './autofix.js'
import { runAutomaticReview } from './review.js'
import { DEFAULT_REVIEW_REQUIREMENTS, normalizeRequirements, refreshReview, reviewInputFingerprint } from './review-state.js'
import { llmJson } from './providers/llm.js'
import { mockConcepts, mockStoryboard, mockShotRevision, mockVariant } from './mock.js'
import { generateShotPreview } from './providers/image.js'
import { submitShot, pollShot } from './providers/video.js'
import {
  hasFfmpeg,
  detectGreenScreen,
  concatClips,
  buildManualConcatCommand,
  applyOverlay,
  extractCover,
  findChineseFont,
} from './providers/ffmpeg.js'
import { hasCredentials } from './providers/gcp-auth.js'
import { buildCouponFromFact, buildCtaCard, buildEndCard } from './providers/coupon.js'
import { synthesizeVo, voiceForTone, VOICE_PRESETS } from './providers/tts.js'

config.vertex.enabled = hasCredentials() && Boolean(config.vertex.geminiModel && config.vertex.imageModel && config.vertex.veoModel)

const app = express()
app.use(cors())
app.use(express.json({ limit: '20mb' }))
app.use('/media', express.static(MEDIA_DIR))

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, MEDIA_DIR),
    filename: (_req, file, cb) =>
      cb(null, `asset-${Date.now()}-${nanoid(6)}${path.extname(file.originalname) || '.png'}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
})

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error('[api]', req.method, req.path, err)
    res.status(err.status || 500).json({ error: err.message })
  })

const PHASES = [
  { id: 1, key: 'foundation', name: '创作基础' },
  { id: 2, key: 'brief', name: '投放需求输入' },
  { id: 3, key: 'concept', name: '广告创意策划' },
  { id: 4, key: 'storyboard', name: '分镜规划' },
  { id: 5, key: 'review', name: '自动审核' },
  { id: 6, key: 'render', name: '生成·合成·测试' },
]

function newProject(name) {
  const now = new Date().toISOString()
  return {
    id: nanoid(10),
    name: name || `花小猪广告素材 ${new Date().toLocaleDateString('zh-CN')}`,
    createdAt: now,
    updatedAt: now,
    phase: 1,
    brandGuideId: 'hxz-ad-v1',
    assets: {
      person: [],
      outfit: [],
      vehicle: [],
      scene: [],
      prop: [],
      productUI: [],
      brand: [],
      overlay: [],
      reference: [],
    },
    facts: [],
    brief: {
      channel: 'oceanengine-douyin',
      audience: 'new-user',
      scene: 'commute-evening',
      campaign: '',
      sellingPoint: '',
      goal: '引导下载与首单',
      tone: 'relatable',
      cta: 'download-claim',
      durationSec: 15,
      reference: '',
      constraints: '',
      notes: '',
    },
    concepts: [],
    selectedConceptId: null,
    storyboard: null,
    review: { mode: 'automatic', status: 'idle', requirements: [...DEFAULT_REVIEW_REQUIREMENTS], approved: false, approvedAt: null, checklist: {}, notes: '' },
    render: { model: '', params: {}, shots: {}, finalVideo: null, cover: null },
    variants: [],
  }
}

async function loadContext(projectId) {
  const project = await getProject(projectId)
  if (!project) {
    const e = new Error('项目不存在')
    e.status = 404
    throw e
  }
  const [brandGuide, assetLib, factLib, channelLib, compliance] = await Promise.all([
    getBrandGuide(),
    getAssets(),
    getFacts(),
    getChannels(),
    getCompliance(),
  ])
  const picked = resolveAssets(project, assetLib)
  const facts = resolveFacts(project, factLib)
  const channel = (channelLib.channels || []).find((c) => c.id === project.brief?.channel) || channelLib.channels?.[0]
  const ctx = { project, brandGuide, assetLib, factLib, channelLib, compliance, picked, facts, channel }
  refreshReview(ctx)
  return ctx
}

const selectedConcept = (p) => p.concepts?.find((c) => c.id === p.selectedConceptId) || null

/* ------------------------------ Meta ------------------------------ */

app.get(
  '/api/meta',
  wrap(async (_req, res) => {
    const [brandGuide, assets, facts, channels, compliance] = await Promise.all([
      getBrandGuide(),
      getAssets(),
      getFacts(),
      getChannels(),
      getCompliance(),
    ])
    res.json({
      phases: PHASES,
      visualDesign: await getVisualDesign(),
      reviewChecklist: DEFAULT_REVIEW_REQUIREMENTS,
      brandGuide,
      assets,
      facts,
      channels: channels.channels || [],
      compliance,
      providers: providerStatus(),
      ffmpeg: await hasFfmpeg(),
      subtitleFont: findChineseFont() || null,
      videoMode: resolvedVideoMode(),
      voices: Object.entries(VOICE_PRESETS).map(([id, v]) => ({ id, name: v.name, desc: v.desc })),
      ttsEnabled: config.tts.enabled && config.vertex.enabled,
      vertex: config.vertex.enabled
        ? { enabled: true, location: config.vertex.location, veoModel: config.vertex.veoModel }
        : { enabled: false },
    })
  }),
)

/* --------------------------- 素材库 --------------------------- */

app.post(
  '/api/assets',
  wrap(async (req, res) => {
    const lib = await getAssets()
    const item = {
      id: `${req.body.category}-${nanoid(6)}`,
      category: req.body.category,
      name: req.body.name,
      nameCn: req.body.nameCn || '',
      prompt: req.body.prompt || '',
      negative: req.body.negative || '',
      refImage: req.body.refImage || null,
      tags: req.body.tags || ['custom'],
      note: req.body.note || '',
      custom: true,
    }
    lib.items.push(item)
    await saveAssets(lib)
    res.json(item)
  }),
)

app.patch(
  '/api/assets/:id',
  wrap(async (req, res) => {
    const lib = await getAssets()
    const item = lib.items.find((i) => i.id === req.params.id)
    if (!item) return res.status(404).json({ error: '素材不存在' })
    Object.assign(item, req.body)
    await saveAssets(lib)
    res.json(item)
  }),
)

app.delete(
  '/api/assets/:id',
  wrap(async (req, res) => {
    const lib = await getAssets()
    lib.items = lib.items.filter((i) => i.id !== req.params.id)
    await saveAssets(lib)
    res.json({ ok: true })
  }),
)

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' })
  res.json({ url: `/media/${req.file.filename}` })
})

/* ------------------- 优惠卡 / CTA 卡片生成 ------------------- */

/**
 * 从已确认事实生成优惠卡片素材。
 * 这是系统内唯一允许产出含金额素材的路径：数据源被强制限定为 confirmed 事实，
 * 既不从网络抓取（第三方优惠信息多为过期或错误），也不交给 AI 绘制（会编造金额）。
 */
app.post(
  '/api/cards/coupon',
  wrap(async (req, res) => {
    const [factLib, brandGuide, assetLib] = await Promise.all([getFacts(), getBrandGuide(), getAssets()])
    const fact = (factLib.facts || []).find((f) => f.id === req.body?.factId)
    if (!fact) return res.status(404).json({ error: '未找到指定的事实条目' })

    const built = await buildCouponFromFact({
      fact,
      brandGuide,
      headline: req.body?.headline,
      baseName: `coupon-${fact.id}-${Date.now()}`,
    })

    // 自动登记为可叠加素材
    const item = {
      id: `overlay-${nanoid(6)}`,
      category: 'overlay',
      name: `Coupon ${fact.id}`,
      nameCn: `优惠卡 · ${req.body?.headline || fact.title}`,
      prompt: '',
      negative: '',
      refImage: built.png,
      tags: ['official-required', 'generated'],
      note: `由事实 ${fact.id} 生成 · 依据来源：${fact.source || '未标注'} · 金额 ${fact.couponAmount}`,
      factId: fact.id,
      custom: true,
    }
    assetLib.items.push(item)
    await saveAssets(assetLib)
    res.json({ card: built, asset: item })
  }),
)

/** 品牌结尾卡：Logo + 品牌色渐变 + CTA，用于结尾整屏叠加 */
app.post(
  '/api/cards/endcard',
  wrap(async (req, res) => {
    const [brandGuide, assetLib] = await Promise.all([getBrandGuide(), getAssets()])
    const logo = assetLib.items.find(
      (i) => i.id === (req.body?.logoAssetId || 'brand-logo-main') && i.refImage?.startsWith('/media/'),
    )
    const built = await buildEndCard({
      brandGuide,
      ctaText: req.body?.ctaText || '',
      logoFile: logo ? path.join(MEDIA_DIR, path.basename(logo.refImage)) : null,
      baseName: `endcard-${nanoid(6)}-${Date.now()}`,
    })
    const item = {
      id: `overlay-${nanoid(6)}`,
      category: 'overlay',
      name: 'End Card',
      nameCn: `品牌结尾卡${req.body?.ctaText ? ` · ${req.body.ctaText}` : ''}`,
      prompt: '',
      negative: '',
      refImage: built.png,
      tags: ['official-required', 'generated'],
      note: '品牌结尾卡（含 Logo 与品牌色），用于结尾镜头整屏叠加',
      custom: true,
    }
    assetLib.items.push(item)
    await saveAssets(assetLib)
    res.json({ card: built, asset: item })
  }),
)

app.post(
  '/api/cards/cta',
  wrap(async (req, res) => {
    const text = String(req.body?.text || '').trim()
    if (!text) return res.status(400).json({ error: '请提供 CTA 文案' })

    const [brandGuide, assetLib, compliance] = await Promise.all([getBrandGuide(), getAssets(), getCompliance()])

    // CTA 文案同样要过合规扫描
    const hits = scanCompliance(compliance, [{ label: 'CTA', text }])
    const blockers = hits.filter((h) => h.severity === 'block')
    if (blockers.length) {
      return res.status(400).json({
        error: `CTA 文案存在合规问题：${blockers.map((b) => `${b.ruleName}「${b.term}」`).join('；')}`,
        hits: blockers,
      })
    }

    const built = await buildCtaCard({ text, brandGuide, baseName: `cta-${nanoid(6)}-${Date.now()}` })
    const item = {
      id: `overlay-${nanoid(6)}`,
      category: 'overlay',
      name: 'CTA Card',
      nameCn: `CTA · ${text}`,
      prompt: '',
      negative: '',
      refImage: built.png,
      tags: ['official-required', 'generated'],
      note: `CTA 按钮素材，已通过合规扫描`,
      custom: true,
    }
    assetLib.items.push(item)
    await saveAssets(assetLib)
    res.json({ card: built, asset: item, warnings: hits.filter((h) => h.severity === 'warn') })
  }),
)

/* --------------------------- 产品事实库 --------------------------- */

app.post(
  '/api/facts',
  wrap(async (req, res) => {
    const lib = await getFacts()
    const fact = {
      id: `fact-${req.body.type || 'custom'}-${nanoid(6)}`,
      type: req.body.type || 'feature',
      status: req.body.status || 'pending',
      title: req.body.title || '',
      statement: req.body.statement || '',
      couponAmount: req.body.couponAmount || '',
      threshold: req.body.threshold || '',
      claimPath: req.body.claimPath || '',
      source: req.body.source || '',
      owner: req.body.owner || '',
      validFrom: req.body.validFrom || null,
      validTo: req.body.validTo || null,
      cities: req.body.cities || '',
      audience: req.body.audience || '',
      conditions: req.body.conditions || [],
      usageNote: req.body.usageNote || '',
      custom: true,
      updatedAt: new Date().toISOString(),
    }
    lib.facts.push(fact)
    await saveFacts(lib)
    res.json(fact)
  }),
)

app.patch(
  '/api/facts/:id',
  wrap(async (req, res) => {
    const lib = await getFacts()
    const fact = lib.facts.find((f) => f.id === req.params.id)
    if (!fact) return res.status(404).json({ error: '事实条目不存在' })
    Object.assign(fact, req.body, { updatedAt: new Date().toISOString() })
    await saveFacts(lib)

    // 事实变更 → 影响面分析
    const all = await listProjects()
    const impacted = []
    for (const summary of all) {
      const p = await getProject(summary.id)
      if (!p?.storyboard) continue
      const im = analyzeImpact({ project: p, changedFactIds: [req.params.id] })
      if (im.shots.length) impacted.push({ projectId: p.id, projectName: p.name, ...im })
    }
    res.json({ fact, impacted })
  }),
)

app.delete(
  '/api/facts/:id',
  wrap(async (req, res) => {
    const lib = await getFacts()
    lib.facts = lib.facts.filter((f) => f.id !== req.params.id)
    await saveFacts(lib)
    res.json({ ok: true })
  }),
)

/* ------------------------------ 项目 ------------------------------ */

app.get('/api/projects', wrap(async (_req, res) => {
  const projects = await listProjects()
  res.json(await Promise.all(projects.map(async summary => {
    const { project } = await loadContext(summary.id)
    return { ...summary, approved: Boolean(project.review?.approved) }
  })))
}))

app.post(
  '/api/projects',
  wrap(async (req, res) => {
    const project = newProject(req.body?.name)
    if (req.body?.template) Object.assign(project, req.body.template)
    await upsertProject(project)
    res.json(project)
  }),
)

app.get(
  '/api/projects/:id',
  wrap(async (req, res) => {
    const { project } = await loadContext(req.params.id)
    res.json(project)
  }),
)

app.patch(
  '/api/projects/:id',
  wrap(async (req, res) => {
    const project = await getProject(req.params.id)
    if (!project) return res.status(404).json({ error: '项目不存在' })
    const gcChanged = Boolean(req.body?.storyboard?.globalContext)
    const changes = { ...req.body }
    // Approval is computed by the review endpoint; clients only edit requirements and notes.
    if (Object.hasOwn(changes, 'review')) {
      changes.review = {}
      if (req.body.review?.requirements !== undefined) changes.review.requirements = normalizeRequirements(req.body.review.requirements)
      if (typeof req.body.review?.notes === 'string') changes.review.notes = req.body.review.notes
    }
    const merged = deepMerge(project, changes)
    merged.id = project.id
    await upsertProject(merged)
    const impact = gcChanged ? analyzeImpact({ project: merged, globalContextChanged: true }) : null
    res.json({ ...merged, _impact: impact })
  }),
)

app.delete(
  '/api/projects/:id',
  wrap(async (req, res) => {
    await deleteProject(req.params.id)
    res.json({ ok: true })
  }),
)

/* --------------------- Phase 3：广告创意 --------------------- */

app.post(
  '/api/projects/:id/concepts',
  wrap(async (req, res) => {
    const { project, brandGuide, compliance, picked, assetLib, facts, channel } = await loadContext(req.params.id)
    const count = Number(req.body?.count || 3)
    const userPreference = req.body?.userPreference || ''
    const avoid = req.body?.keepExisting ? (project.concepts || []).map((c) => c.title) : []

    const messages = conceptMessages({
      brandGuide,
      compliance,
      picked,
      assetLib,
      facts,
      brief: project.brief,
      channel,
      options: { count, userPreference, avoid },
    })
    const { data, source, error } = await llmJson(messages, () =>
      mockConcepts({ brandGuide, brief: project.brief, picked, facts, count, avoid, userPreference }),
    )

    // 创意阶段即做合规扫描
    const fresh = (data.concepts || []).map((c) => {
      const hits = scanCompliance(compliance, [
        { label: '标题', text: c.title },
        { label: '钩子', text: c.hook },
        { label: '卖点', text: c.sellingPoint },
        { label: 'CTA', text: c.ctaText },
      ])
      return { ...c, id: nanoid(8), source, complianceHits: hits, generatedAt: new Date().toISOString() }
    })

    project.concepts = req.body?.keepExisting ? [...(project.concepts || []), ...fresh] : fresh
    if (!project.concepts.find((c) => c.id === project.selectedConceptId)) {
      project.selectedConceptId = project.concepts[0]?.id || null
    }
    project.phase = Math.max(project.phase, 3)
    await upsertProject(project)
    res.json({ project, source, error })
  }),
)

/* --------------------- Phase 4：分镜 --------------------- */

app.post(
  '/api/projects/:id/storyboard',
  wrap(async (req, res) => {
    const { project, brandGuide, compliance, picked, assetLib, facts, channel } = await loadContext(req.params.id)
    const concept = selectedConcept(project)
    if (!concept) return res.status(400).json({ error: '请先在 Phase 3 选择一个创意方案' })

    const options = {
      shotCount: req.body?.shotCount ? Number(req.body.shotCount) : undefined,
      shotDurationSec: req.body?.shotDurationSec ? Number(req.body.shotDurationSec) : undefined,
      userPreference: req.body?.userPreference || '',
    }

    const messages = storyboardMessages({
      brandGuide,
      compliance,
      picked,
      assetLib,
      facts,
      brief: project.brief,
      concept,
      channel,
      options,
    })
    const { data, source, error } = await llmJson(messages, () =>
      mockStoryboard({ brandGuide, brief: project.brief, picked, facts, concept, options }),
    )

    const shots = (data.shots || []).map((s, i) => ({
      vo: '',
      subtitle: '',
      sfx: '',
      renderMode: 'ai',
      overlayItems: [],
      factRefs: [],
      transition: '',
      ...s,
      id: s.id || `shot-${i + 1}`,
      index: i + 1,
      role: s.role || (i === 0 ? 'hook' : 'scene'),
      durationSec: Number(s.durationSec) || 3,
      personRefs: s.personRefs || [],
      vehicleRefs: s.vehicleRefs || [],
      sceneRefs: s.sceneRefs || [],
      uiRefs: s.uiRefs || [],
      preview: null,
      approved: false,
    }))

    project.storyboard = {
      globalContext: data.globalContext || {},
      shots,
      conceptId: concept.id,
      source,
      generatedAt: new Date().toISOString(),
    }
    project.review = { mode: 'automatic', status: 'idle', requirements: project.review?.requirements || [...DEFAULT_REVIEW_REQUIREMENTS], approved: false, approvedAt: null, checklist: {}, notes: project.review?.notes || '' }
    project.render = { ...project.render, shots: {}, finalVideo: null, cover: null }
    project.variants = []
    project.phase = Math.max(project.phase, 4)
    await upsertProject(project)
    res.json({ project, source, error })
  }),
)

app.post(
  '/api/projects/:id/storyboard/shots/:shotId/regenerate',
  wrap(async (req, res) => {
    const { project, brandGuide, compliance, picked, assetLib, facts } = await loadContext(req.params.id)
    const sb = project.storyboard
    if (!sb) return res.status(400).json({ error: '尚未生成分镜' })
    const idx = sb.shots.findIndex((s) => s.id === req.params.shotId)
    if (idx < 0) return res.status(404).json({ error: '镜头不存在' })

    const shot = sb.shots[idx]
    const neighbors = [sb.shots[idx - 1], sb.shots[idx + 1]]
      .filter(Boolean)
      .map((s) => ({ index: s.index, role: s.role, action: s.action, vo: s.vo, prompt: s.prompt }))

    const messages = shotRegenMessages({
      brandGuide,
      compliance,
      picked,
      assetLib,
      facts,
      concept: selectedConcept(project),
      globalContext: sb.globalContext,
      shot,
      neighbors,
      instruction: req.body?.instruction || '',
    })
    const { data, source, error } = await llmJson(messages, () =>
      mockShotRevision({ shot, instruction: req.body?.instruction }),
    )

    sb.shots[idx] = {
      ...shot,
      ...data,
      id: shot.id,
      index: shot.index,
      preview: null,
      approved: false,
      regeneratedAt: new Date().toISOString(),
    }
    await upsertProject(project)
    res.json({ project, source, error })
  }),
)

app.post(
  '/api/projects/:id/storyboard/shots/:shotId/preview',
  wrap(async (req, res) => {
    const { project, brandGuide, picked, channel } = await loadContext(req.params.id)
    const sb = project.storyboard
    const shot = sb?.shots.find((s) => s.id === req.params.shotId)
    if (!shot) return res.status(404).json({ error: '镜头不存在' })

    const compiled = compileShotRenderPrompt({ brandGuide, picked, globalContext: sb.globalContext, shot, channel })
    const preview = await generateShotPreview({
      projectId: project.id,
      shot,
      globalContext: sb.globalContext,
      prompt: compiled.prompt,
      refImages: compiled.refImages,
      safeArea: channel?.safeArea,
    })
    shot.preview = preview
    await upsertProject(project)
    res.json({ project, preview })
  }),
)

app.post(
  '/api/projects/:id/storyboard/shots',
  wrap(async (req, res) => {
    const project = await getProject(req.params.id)
    if (!project?.storyboard) return res.status(400).json({ error: '尚未生成分镜' })
    const after = Number(req.body?.afterIndex ?? project.storyboard.shots.length)
    const shot = {
      id: `shot-${nanoid(5)}`,
      index: 0,
      role: req.body?.role || 'scene',
      titleCn: '新增镜头',
      durationSec: 3,
      personRefs: [],
      vehicleRefs: [],
      sceneRefs: [],
      uiRefs: [],
      cameraAngle: 'eye-level medium shot',
      cameraMovement: 'handheld follow',
      action: '',
      actionCn: '',
      vo: '',
      subtitle: '',
      sfx: '',
      prompt: '',
      negativePrompt: '',
      renderMode: 'ai',
      overlayItems: [],
      factRefs: [],
      transition: '',
      preview: null,
      approved: false,
    }
    project.storyboard.shots.splice(after, 0, shot)
    project.storyboard.shots.forEach((s, i) => (s.index = i + 1))
    await upsertProject(project)
    res.json(project)
  }),
)

app.delete(
  '/api/projects/:id/storyboard/shots/:shotId',
  wrap(async (req, res) => {
    const project = await getProject(req.params.id)
    if (!project?.storyboard) return res.status(400).json({ error: '尚未生成分镜' })
    project.storyboard.shots = project.storyboard.shots.filter((s) => s.id !== req.params.shotId)
    project.storyboard.shots.forEach((s, i) => (s.index = i + 1))
    delete project.render.shots[req.params.shotId]
    await upsertProject(project)
    res.json(project)
  }),
)

/* --------------------- Phase 5：自动审核 --------------------- */
const reviewRuns = new Set()
app.post('/api/projects/:id/review', wrap(async (req, res) => {
  if (reviewRuns.has(req.params.id)) return res.status(409).json({ error: '该项目正在自动审核，请等待完成。' })
  reviewRuns.add(req.params.id)
  try {
    const ctx = await loadContext(req.params.id)
    const originalFingerprint = reviewInputFingerprint(ctx)
    if (req.body?.autoRepair !== undefined && typeof req.body.autoRepair !== 'boolean') return res.status(400).json({ error: 'autoRepair 必须是布尔值' })
    const result = await runAutomaticReview(ctx, { requirements: normalizeRequirements(req.body?.requirements || ctx.project.review?.requirements), autoRepair: req.body?.autoRepair !== false })
    const latest = await loadContext(req.params.id)
    if (reviewInputFingerprint(latest) !== originalFingerprint) return res.status(409).json({ error: '审核期间资料已更新，本次结果未保存，请重新运行审核。' })
    result.project = { ...latest.project, storyboard: result.project.storyboard, assets: result.project.assets, facts: result.project.facts, review: result.project.review, phase: Math.max(latest.project.phase, 5) }
    for (const [id, render] of Object.entries(ctx.project.render?.shots || {})) {
      if (render.stale && result.project.render?.shots?.[id]) {
        result.project.render.shots[id].stale = true
        result.project.render.shots[id].approved = false
      }
    }
    await upsertProject(result.project)
    res.json(result)
  } finally { reviewRuns.delete(req.params.id) }
}))

app.get(
  '/api/projects/:id/validate',
  wrap(async (req, res) => {
    const { project, brandGuide, compliance, factLib, picked, channel } = await loadContext(req.params.id)
    const result = validateStoryboard({ project, brandGuide, compliance, factLib, picked, channel })
    const missingAssets = missingOfficialAssets(picked).map((a) => ({ id: a.id, name: a.nameCn || a.name, note: a.note }))
    res.json({ ...result, missingAssets, channel: channel ? { id: channel.id, name: channel.name } : null })
  }),
)

/**
 * 自动修复：把校验报出的问题真正改掉。
 * body:
 *   shotId              只修某一个镜头（可选）
 *   removeMissingAssets 是否自动移除未上传的官方素材引用（默认 false，优先提示上传）
 */
app.post(
  '/api/projects/:id/autofix',
  wrap(async (req, res) => {
    const ctx = await loadContext(req.params.id)
    const { project, brandGuide, compliance, factLib, facts, picked, channel } = ctx
    if (!project.storyboard) return res.status(400).json({ error: '尚无分镜' })

    const before = validateStoryboard({ project, brandGuide, compliance, factLib, picked, channel })

    const { report } = await autoFix({
      project,
      brandGuide,
      compliance,
      factLib,
      facts,
      picked,
      validation: before,
      options: {
        shotId: req.body?.shotId || null,
        removeMissingAssets: Boolean(req.body?.removeMissingAssets),
      },
    })

    await upsertProject(project)

    // 修复后重新校验（事实选择可能变化，需重新解析）
    const after = validateStoryboard({
      project,
      brandGuide,
      compliance,
      factLib,
      picked: resolveAssets(project, ctx.assetLib),
      channel,
    })

    res.json({
      project,
      report,
      before: before.summary,
      after: after.summary,
      validation: after,
    })
  }),
)

app.get(
  '/api/projects/:id/package',
  wrap(async (req, res) => {
    const { project, brandGuide, picked, facts, channel } = await loadContext(req.params.id)
    const sb = project.storyboard
    if (!sb) return res.status(400).json({ error: '尚未生成分镜' })

    const pkg = {
      project: { id: project.id, name: project.name, updatedAt: project.updatedAt },
      channel: channel ? { id: channel.id, name: channel.name, safeArea: channel.safeArea } : null,
      brief: project.brief,
      concept: selectedConcept(project),
      factsUsed: facts.confirmed.map((f) => ({ id: f.id, title: f.title, statement: f.statement, source: f.source })),
      globalContext: sb.globalContext,
      globalContextText: globalContextBlock(sb.globalContext),
      format: brandGuide.format,
      shots: sb.shots.map((shot) => ({
        id: shot.id,
        index: shot.index,
        role: shot.role,
        titleCn: shot.titleCn,
        durationSec: shot.durationSec,
        vo: shot.vo,
        subtitle: shot.subtitle,
        sfx: shot.sfx,
        transition: shot.transition,
        ...compileShotRenderPrompt({ brandGuide, picked, globalContext: sb.globalContext, shot, channel }),
      })),
      variants: (project.variants || []).map((v) => ({
        id: v.id,
        name: v.variantName,
        variable: v.variable,
        hypothesis: v.hypothesis,
        changedShotIndexes: v.changedShotIndexes,
        fixedShotIndexes: v.fixedShotIndexes,
      })),
    }

    if (req.query.download) {
      res.setHeader('Content-Disposition', `attachment; filename="${project.id}-ad-package.json"`)
    }
    res.json(pkg)
  }),
)

/* --------------------- Phase 6：生成与合成 --------------------- */

app.post(
  '/api/projects/:id/render/shots/:shotId',
  wrap(async (req, res) => {
    const { project, brandGuide, compliance, factLib, picked, channel } = await loadContext(req.params.id)
    const sb = project.storyboard
    const shot = sb?.shots.find((s) => s.id === req.params.shotId)
    if (!shot) return res.status(404).json({ error: '镜头不存在' })

    if (!req.body?.force) {
      if (!project.review?.approved) {
        return res.status(400).json({ error: '分镜尚未通过自动审核或内容已变更，如需强制生成请传 force=true' })
      }
      const v = validateStoryboard({ project, brandGuide, compliance, factLib, picked, channel })
      const shotIssues = v.shots.find((s) => s.shotId === shot.id)?.issues || []
      const blockers = [...v.global, ...shotIssues].filter((i) => i.severity === 'block')
      if (blockers.length) {
        return res.status(400).json({
          error: `存在 ${blockers.length} 项阻断问题，请先修正：${blockers.map((b) => b.reason).join('；')}`,
          blockers,
        })
      }
    }

    if (shot.renderMode === 'asset') {
      return res.status(400).json({
        error: '该镜头标记为使用已确认素材（renderMode=asset），请直接用「回传素材」接入视频文件，不经过 AI 生成。',
      })
    }

    const compiled = compileShotRenderPrompt({ brandGuide, picked, globalContext: sb.globalContext, shot, channel })
    const prev = project.render.shots[shot.id] || { attempts: 0 }

    try {
      const result = await submitShot({
        projectId: project.id,
        shot,
        compiled,
        model: project.render.model || undefined,
        params: project.render.params,
      })
      project.render.shots[shot.id] = {
        ...prev,
        ...result,
        compiled,
        attempts: (prev.attempts || 0) + 1,
        approved: false,
        overlayApplied: false,
        overlayInfo: null,
        // 重新生成后旧源作废，否则后续合成会一直用旧的 rawUrl
        rawUrl: null,
        error: null,
        updatedAt: new Date().toISOString(),
      }
    } catch (err) {
      project.render.shots[shot.id] = {
        ...prev,
        status: 'failed',
        error: err.message,
        compiled,
        attempts: (prev.attempts || 0) + 1,
        updatedAt: new Date().toISOString(),
      }
    }

    project.phase = Math.max(project.phase, 6)
    await upsertProject(project)
    res.json({ project, shotRender: project.render.shots[shot.id] })
  }),
)

app.post(
  '/api/projects/:id/render/shots/:shotId/poll',
  wrap(async (req, res) => {
    const project = await getProject(req.params.id)
    const entry = project?.render?.shots?.[req.params.shotId]
    if (!entry?.taskId) return res.status(400).json({ error: '该镜头没有进行中的远程任务' })
    try {
      const result = await pollShot(entry.taskId, { ...entry, shotId: req.params.shotId })
      // 有了新镜头视频就必须丢弃旧的 rawUrl，
      // 否则后续合成会一直拿旧素材当输入（重新生成的镜头永远不生效）。
      const fresh = result?.url && result.url !== entry.url
      project.render.shots[req.params.shotId] = {
        ...entry,
        ...result,
        ...(fresh ? { rawUrl: null, overlayApplied: false, overlayInfo: null } : {}),
        error: null,
        updatedAt: new Date().toISOString(),
      }
    } catch (err) {
      project.render.shots[req.params.shotId] = {
        ...entry,
        status: 'failed',
        error: err.message,
        updatedAt: new Date().toISOString(),
      }
    }
    await upsertProject(project)
    res.json({ project, shotRender: project.render.shots[req.params.shotId] })
  }),
)

app.post(
  '/api/projects/:id/render/shots/:shotId/attach',
  wrap(async (req, res) => {
    const project = await getProject(req.params.id)
    if (!project) return res.status(404).json({ error: '项目不存在' })
    const prev = project.render.shots[req.params.shotId] || {}
    project.render.shots[req.params.shotId] = {
      ...prev,
      status: 'succeeded',
      url: req.body.url,
      source: 'manual',
      stale: false,
      approved: false,
      overlayApplied: false,
      overlayInfo: null,
      rawUrl: null,
      error: null,
      updatedAt: new Date().toISOString(),
    }
    await upsertProject(project)
    res.json(project)
  }),
)

/**
 * 对单个镜头执行「后期合成」：字幕烧录 + 界面/优惠卡/Logo 叠加 + 口播配音混音。
 *
 * 这是成片有文案、有声音、有品牌的关键一步。
 * 之前它只是一个手动端点，运营点了「生成」再点「合成成片」就会整段跳过，
 * 导致成片是裸 AI 画面。现在抽成函数，由 assemble 自动调用。
 *
 * @returns { entry, info } 更新后的 render 记录
 */
async function composeShot({ project, shot, picked, channel, brandGuide, subtitleOverride, voicePreset }) {
  const entry = project.render.shots[shot.id]
  if (entry?.stale) throw new Error('分镜已自动修复，请重新生成或回传该镜头后再合成。')
  if (!entry?.url) throw new Error(`镜头 #${shot.index} 尚无可用视频`)
  if (!entry.url.startsWith('/media/')) {
    throw new Error(`镜头 #${shot.index} 是外部 URL，无法本地合成，请先下载到 data/runtime/media 后回传`)
  }

  // 始终以原始素材为输入，保证重复合成不会叠加两次字幕。
  // 防御：合成产物命名以 ov- 开头，绝不能被当成输入源。
  const candidate = entry.rawUrl || entry.url
  const sourceUrl = candidate && path.basename(candidate).startsWith('ov-') ? entry.rawUrl : candidate
  if (!sourceUrl || path.basename(sourceUrl).startsWith('ov-')) {
    throw new Error(`镜头 #${shot.index} 的原始视频源已丢失，请重新生成该镜头`)
  }
  const srcFile = path.join(MEDIA_DIR, path.basename(sourceUrl))
  if (!fs.existsSync(srcFile)) throw new Error(`镜头 #${shot.index} 的源视频文件不存在`)

  const all = Object.values(picked).flat()

  // 1) 内容素材：App 界面、优惠卡
  //    多个素材必须错开位置，否则会完全重叠（界面被优惠卡盖住看不出是什么）
  //    布局约定：界面类居中作为主体，优惠卡类走右下角小尺寸挂角
  const contentAssets = (shot.uiRefs || [])
    .map((id) => all.find((a) => a.id === id))
    .filter((a) => a?.refImage?.startsWith('/media/') && a.category !== 'brand')

  const uiCount = contentAssets.filter((a) => a.category === 'productUI').length
  const contentImages = contentAssets.map((a) => {
    const isUi = a.category === 'productUI'
    // 布局约定：素材并排挂在字幕上方（界面居左、卡券居右），
    // 悬空大图会盖住人物；若检测到绿幕手机屏，界面会改为填入屏幕（见下）
    if (isUi) {
      return {
        file: path.join(MEDIA_DIR, path.basename(a.refImage)),
        position: 'bottom-left',
        widthRatio: 0.42,
        assetId: a.id,
        assetName: a.nameCn || a.name,
      }
    }
    return {
      file: path.join(MEDIA_DIR, path.basename(a.refImage)),
      position: uiCount > 0 ? 'bottom-right' : 'center',
      widthRatio: uiCount > 0 ? 0.28 : 0.62,
      assetId: a.id,
      assetName: a.nameCn || a.name,
    }
  })

  // 2) 品牌素材：Logo 类走底部（结尾镜头的主视觉）
  const brandImages = (shot.uiRefs || [])
    .map((id) => all.find((a) => a.id === id))
    .filter((a) => a?.refImage?.startsWith('/media/') && a.category === 'brand')
    .map((a) => ({
      file: path.join(MEDIA_DIR, path.basename(a.refImage)),
      position: 'bottom',
      widthRatio: 0.46,
      assetId: a.id,
      assetName: a.nameCn || a.name,
    }))

  // 3) 品牌角标：非结尾镜头右上角常驻，持续强化品牌
  const logoAsset = all.find((a) => a.category === 'brand' && a.refImage?.startsWith('/media/'))
  const wantWatermark = shot.role !== 'cta' && logoAsset && !brandImages.length
  const logoFile = wantWatermark ? path.join(MEDIA_DIR, path.basename(logoAsset.refImage)) : null

  // 4) 口播配音
  //    语速必须按视频的「实际时长」反推：Veo 只支持 4/6/8 秒，
  //    分镜写 5s 时实际产出 4s，用 5s 算语速会导致口播被截断。
  const realDuration = Number(entry.actualDurationSec) || Number(shot.durationSec) || 4
  const subtitle = subtitleOverride ?? shot.subtitle
  let vo = null
  let voError = null
  if (shot.vo && config.tts.enabled && config.vertex.enabled) {
    try {
      vo = await synthesizeVo({
        text: shot.vo,
        voicePreset: voicePreset || project.render?.voicePreset || voiceForTone(project.brief?.tone),
        targetSec: realDuration,
        baseName: `vo-${project.id}-${shot.id}-${Date.now()}`,
      })
    } catch (e) {
      voError = e.message
      console.error('[tts]', e.message)
    }
  }

  // 4.5) 绿幕检测 → 手机屏合成
  //     AI 画不出可用的关机屏，但常把「等待后期替换」的屏幕渲染成纯绿。
  //     检测到绿幕就把真实 App 截图填进屏幕区域，手机真的在显示 App。
  let screenFit = null
  const uiAsset = contentAssets.find((a) => a.category === 'productUI')
  if (uiAsset) {
    try {
      const gs = await detectGreenScreen(srcFile)
      if (gs.found) {
        screenFit = {
          file: path.join(MEDIA_DIR, path.basename(uiAsset.refImage)),
          box: gs.box,
        }
      }
    } catch (e) {
      console.error('[green-screen]', e.message)
    }
  }

  // 界面已填入手机屏时，就不再叠大图，避免盖住人物
  const remainingImages = screenFit
    ? [...contentImages.filter((i) => i.assetId !== uiAsset.id), ...brandImages]
    : [...contentImages, ...brandImages]

  const outName = `ov-${project.id}-${shot.id}-${Date.now()}.mp4`
  const result = await applyOverlay({
    inFile: srcFile,
    outFile: path.join(MEDIA_DIR, outName),
    subtitle,
    images: remainingImages,
    screenFit,
    voFile: vo?.file || null,
    voVolume: config.tts.voVolume,
    ambientVolume: config.tts.ambientVolume,
    logoFile,
    brandColor: brandGuide?.brandIdentity?.primaryColor || '#FF3E7F',
    safeArea: channel?.safeArea,
    durationSec: realDuration,
  })

  const info = {
    images: remainingImages.length,
    imageNames: remainingImages.map((i) => i.assetName),
    screenFit: Boolean(screenFit),
    subtitle: Boolean(subtitle && result.font),
    subtitleText: subtitle || '',
    watermark: Boolean(logoFile),
    vo: vo
      ? {
          url: vo.url,
          voiceName: vo.voiceName,
          rate: vo.rate,
          chars: vo.chars,
          estimatedSec: vo.estimatedSec,
          overflow: vo.overflow,
        }
      : null,
    voError,
    font: result.font,
    note: result.reason,
  }

  project.render.shots[shot.id] = {
    ...entry,
    rawUrl: sourceUrl,
    url: `/media/${outName}`,
    overlayApplied: true,
    overlayInfo: info,
    // 画面内容变了，需要重新确认
    approved: false,
    updatedAt: new Date().toISOString(),
  }

  return { entry: project.render.shots[shot.id], info }
}

/** 叠加字幕与图片素材：优惠、界面、Logo、CTA、配音全部在这里精确合成 */
app.post(
  '/api/projects/:id/render/shots/:shotId/overlay',
  wrap(async (req, res) => {
    const { project, picked, channel, brandGuide } = await loadContext(req.params.id)
    const shot = project.storyboard?.shots.find((s) => s.id === req.params.shotId)
    if (!shot) return res.status(404).json({ error: '镜头不存在' })
    if (!(await hasFfmpeg())) return res.status(400).json({ error: '未检测到 ffmpeg，无法执行叠加合成' })

    const { info } = await composeShot({
      project,
      shot,
      picked,
      channel,
      brandGuide,
      subtitleOverride: req.body?.subtitle,
      voicePreset: req.body?.voicePreset,
    })
    await upsertProject(project)
    res.json({ project, shotRender: project.render.shots[shot.id], info })
  }),
)

app.post(
  '/api/projects/:id/render/shots/:shotId/approve',
  wrap(async (req, res) => {
    const project = await getProject(req.params.id)
    const entry = project?.render?.shots?.[req.params.shotId]
    if (!entry) return res.status(404).json({ error: '该镜头尚未生成' })
    if (entry.stale) return res.status(400).json({ error: '分镜已变更，请重新生成或回传该镜头。' })
    entry.approved = req.body?.approved !== false
    entry.reviewNote = req.body?.note || ''
    await upsertProject(project)
    res.json(project)
  }),
)

/**
 * 合成成片。
 *
 * 关键变化：合成前会**自动为每个镜头执行后期合成**（字幕 + 界面/优惠卡/Logo + 配音），
 * 不再要求运营先逐个点「叠加」。这解决了「成片没有文案、没有声音、
 * 上传的界面素材没被使用」的问题 —— 根因就是这一步此前会被整段跳过。
 *
 * body.skipCompose=true 可跳过自动合成（用于已手动处理好的场景）
 */
app.post(
  '/api/projects/:id/render/assemble',
  wrap(async (req, res) => {
    const { project, picked, channel, brandGuide } = await loadContext(req.params.id)
    const sb = project.storyboard
    if (!sb) return res.status(400).json({ error: '尚未生成分镜' })

    if (!project.review?.approved) return res.status(400).json({ error: '请先完成当前版本的自动审核，再合成成片。' })
    if (sb.shots.some(shot => project.render.shots[shot.id]?.stale)) return res.status(400).json({ error: '存在自动修复前的旧镜头，请重新生成或回传后再合成。' })
    const missing = sb.shots.filter((s) => !project.render.shots[s.id]?.url)
    if (missing.length) {
      return res.status(400).json({
        error: `还有 ${missing.length} 个镜头没有可用视频：${missing.map((s) => `#${s.index}`).join(', ')}`,
      })
    }

    const ffmpegOk = await hasFfmpeg()
    const composeLog = []

    // ---- 自动后期合成：字幕 / 素材 / 配音 ----
    if (ffmpegOk && !req.body?.skipCompose) {
      for (const shot of sb.shots) {
        const entry = project.render.shots[shot.id]
        const needs =
          shot.subtitle ||
          shot.vo ||
          (shot.uiRefs || []).length ||
          shot.renderMode === 'overlay'
        if (!needs) {
          composeLog.push({ index: shot.index, skipped: '无需叠加' })
          continue
        }
        if (!entry.url.startsWith('/media/')) {
          composeLog.push({ index: shot.index, skipped: '外部 URL，无法本地合成' })
          continue
        }
        try {
          const { info } = await composeShot({ project, shot, picked, channel, brandGuide })
          composeLog.push({
            index: shot.index,
            subtitle: info.subtitle,
            images: info.images,
            imageNames: info.imageNames,
            watermark: info.watermark,
            vo: Boolean(info.vo),
            voInfo: info.vo,
            voError: info.voError,
          })
        } catch (e) {
          composeLog.push({ index: shot.index, error: e.message })
          console.error(`[compose] shot #${shot.index}`, e.message)
        }
      }
      await upsertProject(project)
    }

    const ordered = sb.shots.map((s) => project.render.shots[s.id])
    const localFiles = ordered
      .map((e) => e.url)
      .filter((u) => u.startsWith('/media/'))
      .map((u) => path.join(MEDIA_DIR, path.basename(u)))

    if (localFiles.length !== ordered.length) {
      return res.status(400).json({
        error: '存在外部视频 URL，无法本地合成。请先下载到 data/runtime/media 后重试。',
        externalUrls: ordered.map((e) => e.url),
      })
    }

    if (!ffmpegOk) {
      return res.json({
        project,
        ffmpeg: false,
        manual: buildManualConcatCommand(localFiles, `final-${project.id}.mp4`),
      })
    }

    const outName = `final-${project.id}-${Date.now()}.mp4`
    await concatClips({ files: localFiles, outFile: path.join(MEDIA_DIR, outName) })

    // 封面：信息流素材首帧直接影响 CTR
    const coverName = `cover-${project.id}-${Date.now()}.jpg`
    let cover = null
    try {
      await extractCover({ inFile: path.join(MEDIA_DIR, outName), outFile: path.join(MEDIA_DIR, coverName) })
      cover = `/media/${coverName}`
    } catch (e) {
      console.error('[cover]', e.message)
    }

    const withSubtitle = ordered.filter((e) => e.overlayInfo?.subtitle).length
    const withVo = ordered.filter((e) => e.overlayInfo?.vo).length
    const withAssets = ordered.filter((e) => (e.overlayInfo?.images || 0) > 0).length

    project.render.finalVideo = {
      url: `/media/${outName}`,
      shotCount: ordered.length,
      durationSec: sb.shots.reduce((a, s) => a + (Number(s.durationSec) || 0), 0),
      overlayCount: ordered.filter((e) => e.overlayApplied).length,
      subtitleCount: withSubtitle,
      voCount: withVo,
      assetCount: withAssets,
      assembledAt: new Date().toISOString(),
    }
    project.render.cover = cover
    await upsertProject(project)
    res.json({ project, ffmpeg: true, composeLog })
  }),
)

/* --------------------- Phase 6：单变量测试变体 --------------------- */

app.post(
  '/api/projects/:id/variants',
  wrap(async (req, res) => {
    const { project, brandGuide, compliance, picked, assetLib, facts } = await loadContext(req.params.id)
    const sb = project.storyboard
    if (!sb) return res.status(400).json({ error: '尚未生成分镜' })
    const variable = req.body?.variable
    if (!variable) return res.status(400).json({ error: '请指定测试变量' })

    const messages = variantMessages({
      brandGuide,
      compliance,
      picked,
      assetLib,
      facts,
      concept: selectedConcept(project),
      globalContext: sb.globalContext,
      shots: sb.shots,
      variable,
      instruction: req.body?.instruction || '',
    })
    const { data, source, error } = await llmJson(messages, () =>
      mockVariant({ shots: sb.shots, variable, brandGuide }),
    )

    const variant = {
      id: nanoid(8),
      variable,
      variantName: data.variantName || `变体 · ${variable}`,
      hypothesis: data.hypothesis || '',
      changeSummary: data.changeSummary || '',
      changedShotIndexes: data.changedShotIndexes || [],
      fixedShotIndexes: data.fixedShotIndexes || [],
      shots: (data.shots || []).map((s) => {
        const base = sb.shots.find((b) => b.index === s.index)
        return { ...base, ...s, id: `${base?.id || 'shot'}-v${nanoid(4)}`, baseShotId: base?.id, preview: null, approved: false }
      }),
      source,
      render: { shots: {}, finalVideo: null },
      createdAt: new Date().toISOString(),
    }
    project.variants = [...(project.variants || []), variant]
    await upsertProject(project)
    res.json({ project, variant, source, error })
  }),
)

app.delete(
  '/api/projects/:id/variants/:variantId',
  wrap(async (req, res) => {
    const project = await getProject(req.params.id)
    project.variants = (project.variants || []).filter((v) => v.id !== req.params.variantId)
    await upsertProject(project)
    res.json(project)
  }),
)

/* --------------------- 影响面分析 --------------------- */

app.get(
  '/api/projects/:id/impact',
  wrap(async (req, res) => {
    const project = await getProject(req.params.id)
    if (!project) return res.status(404).json({ error: '项目不存在' })
    const changedFactIds = String(req.query.factIds || '').split(',').filter(Boolean)
    res.json(analyzeImpact({ project, changedFactIds, globalContextChanged: req.query.global === '1' }))
  }),
)

/* --------------------- 静态前端 --------------------- */

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/media')) return next()
    res.sendFile(path.join(DIST_DIR, 'index.html'))
  })
}

app.listen(config.port, () => {
  const s = providerStatus()
  console.log(`\n  花小猪打车 · AI 广告短视频工作流 API`)
  console.log(`  http://localhost:${config.port}`)
  if (config.vertex.enabled) {
    console.log(`  Vertex AI: location=${config.vertex.location}`)
  }
  console.log(`  LLM: ${s.llm}`)
  console.log(`  Image: ${s.image}`)
  console.log(`  Video: ${s.video} (mode=${resolvedVideoMode()})`)
  console.log(`  中文字体: ${findChineseFont() || '未找到（字幕烧录不可用）'}\n`)
})
