import { createHash, randomUUID } from 'node:crypto'

export const EXPERIMENT_VARIABLES = { hook: '开头内容', cta: '结尾行动引导' }
export const PRIMARY_METRICS = { ctr: '点击率 CTR', cvr: '点击转化率 CVR', cpa: '转化成本 CPA' }
const creativeFields = ['titleCn', 'vo', 'subtitle', 'action', 'actionCn', 'prompt', 'negativePrompt', 'sfx']
export const failure = (message, status = 400) => Object.assign(new Error(message), { status })
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]))
  return value
}
export const fingerprint = value => createHash('sha256').update(JSON.stringify(canonical(value ?? null))).digest('hex')
export function baselineFrozen(project, projects) {
  const link = project.experimentLink
  return link?.label === 'A' && (projects.find(p => p.id === link.parentId)?.experiments?.find(e => e.id === link.experimentId)?.versions.length || 0) > 1
}
export function assertFrozenMedia(project, original, projects) {
  if (!baselineFrozen(original, projects)) return
  const media = p => ({ final: p.render?.finalVideo?.url, clips: Object.fromEntries((p.storyboard?.shots || []).map(s => [s.id, p.render?.shots?.[s.id]?.url])) })
  if (fingerprint(media(project)) !== fingerprint(media(original))) throw failure('A 基准版已被实验版引用，视频已锁定。请在源任务建立新实验。', 409)
}
export function fixedContent(project, editableShotIds = []) {
  return {
    assets: project.assets, facts: project.facts, brief: project.brief, concepts: project.concepts,
    selectedConceptId: project.selectedConceptId, voicePreset: project.render?.voicePreset, model: project.render?.model, renderParams: project.render?.params,
    storyboard: project.storyboard && { ...project.storyboard, shots: project.storyboard.shots.map(shot => {
      const copy = { ...shot }; delete copy.preview; delete copy.approved
      if (editableShotIds.includes(shot.id)) for (const key of creativeFields) delete copy[key]
      return copy
    }) },
  }
}
export function assertExperimentLock(project, original = project) {
  const lock = original.experimentLink
  if (!lock) return
  if (fingerprint(project.experimentLink) !== fingerprint(lock) || fingerprint(fixedContent(project, lock.editableShotIds)) !== lock.fixedFingerprint) {
    throw failure('实验版本的固定项已锁定。请返回源任务调整后建立新实验；当前版本只允许修改指定镜头的内容。', 409)
  }
  if (lock.fixedRenders && fingerprint(Object.fromEntries(Object.keys(lock.fixedRenders).map(id => [id, project.render.shots[id]?.url]))) !== fingerprint(lock.fixedRenders)) throw failure('固定镜头必须复用 A 基准版的视频，不能单独重新生成或替换。', 409)
}
export function createExperiment(project, input) {
  if (project.experimentLink) throw failure('请在源任务建立实验')
  if (!project.storyboard?.shots?.length) throw failure('请先选定创意并生成基准分镜')
  if (!EXPERIMENT_VARIABLES[input.variable] || !PRIMARY_METRICS[input.primaryMetric]) throw failure('请选择有效的测试变量和主指标')
  const hypothesis = String(input.hypothesis || '').trim()
  if (!hypothesis || hypothesis.length > 1000) throw failure('请填写 1–1000 字的实验假设')
  const editable = input.variable === 'hook' ? project.storyboard.shots[0] : project.storyboard.shots.at(-1)
  const id = randomUUID(), baselineId = randomUUID(), createdAt = new Date().toISOString()
  const baseline = structuredClone(project)
  delete baseline.experiments
  baseline.id = baselineId; baseline.name = `${project.name} · A 基准版`; baseline.createdAt = createdAt
  baseline.variants = []; baseline.phase = baseline.render.finalVideo ? 6 : 4
  baseline.experimentLink = { experimentId: id, parentId: project.id, label: 'A', editableShotIds: [], fixedFingerprint: fingerprint(fixedContent(baseline)) }
  const experiment = {
    id, title: String(input.title || `${EXPERIMENT_VARIABLES[input.variable]}实验`).slice(0, 100),
    variable: input.variable, primaryMetric: input.primaryMetric, hypothesis, createdAt,
    editableShotId: editable.id, editableShotIndex: editable.index,
    plan: { audience: input.audience || project.brief.audience, budget: String(input.budget || ''), period: String(input.period || ''), attribution: String(input.attribution || '待填写'),
      trafficMethod: input.trafficMethod === 'platform-split' ? 'platform-split' : 'observational' },
    versions: [{ label: 'A', projectId: baselineId, name: '基准版', source: 'snapshot' }], observations: [],
    conclusion: '', nextAction: '',
  }
  return { experiment, baseline }
}
export function createExperimentVersion(baseline, experiment, changes, source = 'manual') {
  const original = baseline.storyboard.shots.find(s => s.id === experiment.editableShotId)
  if (!original) throw failure('基准镜头不存在', 409)
  const accepted = {}
  for (const key of creativeFields) {
    if (changes[key] === undefined) continue
    if (typeof changes[key] !== 'string' || changes[key].length > 6000) throw failure('变体内容格式无效')
    accepted[key] = changes[key]
  }
  if (!Object.keys(accepted).some(key => accepted[key] !== (original[key] || ''))) throw failure('变体需至少改变指定镜头的一项内容')
  const project = structuredClone(baseline), label = String.fromCharCode(65 + experiment.versions.length)
  project.id = randomUUID(); project.createdAt = new Date().toISOString()
  project.versionPlan = null // The experiment's shot lock defines the explicitly selected variable.
  project.name = baseline.name.replace(/ · A 基准版$/, '') + ` · ${label} 实验版`
  const shot = project.storyboard.shots.find(s => s.id === original.id)
  Object.assign(shot, accepted, { preview: null, approved: false })
  delete project.render.shots[shot.id]
  project.render.finalVideo = null; project.render.cover = null; delete project.render.qualityReview
  project.review = { ...project.review, approved: false, approvedAt: null, status: 'stale' }
  project.phase = 4
  project.experimentLink = { experimentId: experiment.id, parentId: baseline.experimentLink.parentId, label, editableShotIds: [shot.id], fixedFingerprint: fingerprint(fixedContent(project, [shot.id])),
    fixedRenders: Object.fromEntries(project.storyboard.shots.filter(s => s.id !== shot.id).map(s => [s.id, project.render.shots[s.id]?.url])) }
  return { project, version: { label, projectId: project.id, name: String(changes.variantName || `${label} 实验版`).slice(0, 100), source } }
}
export function parseCsv(content) {
  if (typeof content !== 'string' || content.length > 1024 * 1024) throw failure('CSV 不能为空或超过 1 MB')
  const rows = []; let row = [], cell = '', quoted = false
  for (let i = 0; i < content.length; i++) {
    const c = content[i]
    if (c === '"') { if (quoted && content[i + 1] === '"') { cell += '"'; i++ } else quoted = !quoted }
    else if (c === ',' && !quoted) { row.push(cell); cell = '' }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && content[i + 1] === '\n') i++
      row.push(cell); if (row.some(v => v.trim())) rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (quoted) throw failure('CSV 引号未闭合')
  row.push(cell); if (row.some(v => v.trim())) rows.push(row)
  const headers = rows.shift()?.map((s, i) => s.replace(i ? /^$/ : /^\uFEFF/, '').trim())
  const required = ['version', 'startDate', 'endDate', 'impressions', 'clicks', 'conversions', 'spend', 'source']
  if (!headers || new Set(headers).size !== headers.length || required.some(h => !headers.includes(h))) throw failure('请使用下载的 CSV 模板，必填列缺失或重复')
  if (!rows.length || rows.length > 500) throw failure('请导入 1–500 行数据')
  return rows.map((values, i) => {
    if (values.length !== headers.length) throw failure(`第 ${i + 2} 行列数不匹配`)
    return Object.fromEntries(headers.map((h, j) => [h, values[j].trim()]))
  })
}
export function normalizeObservations(rows, experiment, projects) {
  const dates = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
  const seen = new Set()
  return rows.map((row, index) => {
    const version = experiment.versions.find(v => v.label === row.version || v.projectId === row.version)
    const project = version && projects.find(p => p.id === version.projectId)
    if (!project?.render.finalVideo || project.render.finalVideo.stale || project.storyboard.shots.some(s => project.render.shots[s.id]?.stale)) throw failure(`第 ${index + 2} 行：该版本尚无有效成片，不能关联投放数据`)
    if (project.storyboard.shots.some(s => ['mock', 'simulated'].includes(project.render.shots[s.id]?.backend) || project.render.shots[s.id]?.status === 'simulated')) throw failure('演示视频不能导入真实投放数据')
    if (!dates(row.startDate) || !dates(row.endDate) || row.endDate < row.startDate) throw failure('数据统计日期无效')
    if (!row.source?.trim()) throw failure('请填写数据来源')
    const metrics = {}
    for (const key of ['impressions', 'clicks', 'conversions', 'spend']) {
      const n = Number(row[key])
      if (row[key] === '' || row[key] == null || !Number.isFinite(n) || n < 0 || key !== 'spend' && !Number.isSafeInteger(n)) throw failure(`第 ${index + 2} 行 ${key} 需为非负数，曝光/点击/转化需为整数`)
      metrics[key] = n
    }
    if (metrics.clicks > metrics.impressions || metrics.conversions > metrics.clicks) throw failure('本模板使用点击归因转化：转化数不能超过点击，点击不能超过曝光')
    const key = `${version.projectId}:${row.startDate}:${row.endDate}`
    if (seen.has(key)) throw failure('同一版本和统计区间不能重复导入')
    seen.add(key)
    return { key, projectId: version.projectId, version: version.label, startDate: row.startDate, endDate: row.endDate,
      source: row.source.slice(0, 500), ...metrics, videoUrl: project.render.finalVideo.url, importedAt: new Date().toISOString() }
  })
}
export function mergeObservations(previous, incoming) {
  const merged = previous.filter(old => !incoming.some(row => row.key === old.key))
  for (const row of incoming) {
    if (merged.some(old => old.projectId === row.projectId && row.startDate <= old.endDate && row.endDate >= old.startDate)) throw failure('统计区间存在重叠，请使用相同区间更新或导入互不重叠的区间')
    merged.push(row)
  }
  return merged
}
export function experimentReport(experiment, projects) {
  const versions = experiment.versions.map(version => {
    const project = projects.find(p => p.id === version.projectId)
    const observations = experiment.observations.filter(row => row.projectId === version.projectId)
    const totals = observations.reduce((a, row) => { for (const k of ['impressions', 'clicks', 'conversions', 'spend']) a[k] += row[k]; return a }, { impressions: 0, clicks: 0, conversions: 0, spend: 0 })
    return { ...version, available: Boolean(project), videoUrl: project?.render.finalVideo?.url, cover: project?.render.cover,
      shotCount: project?.storyboard?.shots.length || 0, readyShots: Object.values(project?.render.shots || {}).filter(r => r.url && !r.stale).length,
      staleVideo: Boolean(project?.render.finalVideo?.stale), staleData: Boolean(project?.render.finalVideo?.stale) || observations.some(row => row.videoUrl !== project?.render.finalVideo?.url), hasData: observations.length > 0, totals,
      metrics: { ctr: totals.impressions ? totals.clicks / totals.impressions : null, cvr: totals.clicks ? totals.conversions / totals.clicks : null, cpa: totals.conversions ? totals.spend / totals.conversions : null } }
  })
  const periods = experiment.versions.map(v => experiment.observations.filter(r => r.projectId === v.projectId).map(r => `${r.startDate}/${r.endDate}`).sort().join(','))
  const comparable = versions.length > 1 && versions.every(v => v.hasData && !v.staleData && v.metrics[experiment.primaryMetric] !== null && v.totals.impressions > 0) && periods.every(p => p === periods[0])
  return { ...experiment, versions, comparable,
    evidence: comparable ? '同统计区间的描述性比较；未验证分流执行与统计显著性，不自动判定胜出。' : '请为各版本导入相同统计区间且对应当前成片的数据，再比较效果。' }
}
