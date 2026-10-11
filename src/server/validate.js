/**
 * 广告素材校验器
 * ---------------------------------------------------------------
 * 三类前置校验，在 Phase 5 审核与 Phase 6 生成前拦截问题：
 *  1. 合规扫描：广告法极限词 / 绝对化用语 / 贬低竞品 / 虚假承诺
 *  2. 事实绑定：涉及金额、门槛、时间的表述必须引用已确认事实
 *  3. 口播语速：中文约 5 字/秒，超出镜头时长则无法自然念完
 *
 * 每条问题都带 fix 字段，说明「具体怎么改」以及能否一键修复：
 *   fix.action  修复动作类型，由 autofix.js 执行
 *   fix.label   给运营看的中文修复说明
 *   fix.auto    true=可一键修复，false=需人工介入（如上传素材）
 */

import { usableFact } from './workspace.js'

export const CN_CHARS_PER_SEC = 5
export const VO_SAFETY_RATIO = 0.85
export const SUBTITLE_MAX_LEN = 14

/** 统计中文字符数（忽略标点与空白） */
export function countCn(text) {
  return (String(text || '').match(/[\u4e00-\u9fa5a-zA-Z0-9]/g) || []).length
}

/** 镜头口播字数预算 */
export function voBudget(durationSec) {
  return Math.floor((Number(durationSec) || 0) * CN_CHARS_PER_SEC * VO_SAFETY_RATIO)
}

/* ------------------------- 合规扫描 ------------------------- */

export function scanCompliance(compliance, texts) {
  const hits = []
  const joined = texts.map((t) => ({ label: t.label, field: t.field, text: String(t.text || '') })).filter((t) => t.text)

  for (const rule of compliance.rules || []) {
    for (const term of rule.terms || []) {
      for (const t of joined) {
        if (t.text.includes(term)) {
          hits.push({
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity,
            basis: rule.basis,
            term,
            where: t.label,
            field: t.field,
            excerpt: t.text.slice(Math.max(0, t.text.indexOf(term) - 8), t.text.indexOf(term) + term.length + 8),
          })
        }
      }
    }
  }
  return hits
}

/** 合规问题的修复建议：按规则类型给出可执行的改写方向 */
const COMPLIANCE_FIX_HINT = {
  superlative: '删除极限词，改为具体可验证的描述（如「最便宜」→「价格实惠」、「第一」→ 直接讲产品功能）',
  guarantee: '删除保证性表述，改为客观描述（如「保证准时」→「行前可看预估价」）',
  competitor: '删除对竞品的比较与贬低，只讲自身产品价值',
  'urgency-fake': '限时限量表述需有真实活动依据，无依据则删除紧迫性措辞',
  'money-claim': '删除夸大收益的表述，金额必须与已确认事实一致',
  'safety-absolute': '删除安全绝对化承诺，改为「平台提供安全保障措施」类客观表述',
  'medical-social': '删除医疗功效与社会补贴类表述',
  vulgar: '删除低俗或不适宜表达',
}

/* ------------------------- 事实绑定校验 ------------------------- */

export function checkFactBinding(compliance, factLib, project, shot) {
  const patterns = (compliance.requireFactBinding?.patterns || []).map((p) => new RegExp(p))
  const campaignOnly = (compliance.requireFactBinding?.campaignOnlyPatterns || []).map((p) => new RegExp(p))
  const text = [shot.vo, shot.subtitle, (shot.overlayItems || []).join(' ')].filter(Boolean).join(' ')
  if (!text) return null

  const matched = patterns.filter((re) => re.test(text))
  if (!matched.length) return null

  // 是否属于「活动权益类」表述 —— 这类必须由 campaign 事实支撑，功能事实不够
  const campaignHits = campaignOnly.filter((re) => re.test(text)).map((re) => re.source)
  const needsCampaign = campaignHits.length > 0

  const byId = new Map((factLib.facts || []).map((f) => [f.id, f]))
  const refs = shot.factRefs || []
  const resolved = refs.map((id) => byId.get(id)).filter(Boolean)
  const confirmed = resolved.filter(f => usableFact(f))
  const notSelected = refs.filter((id) => !(project.facts || []).includes(id))

  const available = (project.facts || [])
    .map((id) => byId.get(id))
    .filter((f) => f && usableFact(f))
  const availableCampaign = available.filter((f) => f.type === 'campaign')

  const stripFix = {
    action: 'strip-claim',
    label: needsCampaign
      ? '项目内没有已确认的活动事实，将删除文案中的优惠 / 金额 / 领券类表述，改为只讲产品功能。如需保留优惠表达，请先在 Phase 1 补齐活动资料并标为「已确认」'
      : '删除文案中的活动类表述，只讲产品功能',
    auto: true,
  }

  if (!refs.length) {
    return {
      severity: 'block',
      reason: `文案包含${needsCampaign ? '优惠 / 金额 / 领券' : '活动'}类表述，但未绑定任何产品事实（factRefs 为空）`,
      text,
      fix: needsCampaign
        ? availableCampaign.length
          ? {
              action: 'bind-fact',
              label: `绑定已确认的活动事实「${availableCampaign[0].title}」；若文案金额与该事实不符，请改用删除优惠表述`,
              auto: true,
              payload: { factIds: [availableCampaign[0].id] },
            }
          : stripFix
        : available.length
          ? {
              action: 'bind-fact',
              label: `绑定已确认事实「${available[0].title}」`,
              auto: true,
              payload: { factIds: [available[0].id] },
            }
          : stripFix,
    }
  }

  if (!confirmed.length) {
    return {
      severity: 'block',
      reason: `绑定的事实未确认、不在有效期内或日期待补充：${resolved.map((f) => `${f.id}(${f.status})`).join(', ') || refs.join(', ')}`,
      text,
      fix:
        !(needsCampaign ? availableCampaign.length : available.length)
          ? stripFix
          : {
              action: 'bind-fact',
              label: `改绑已确认事实「${(needsCampaign ? availableCampaign[0] : available[0])?.title}」`,
              auto: true,
              payload: { factIds: [(needsCampaign ? availableCampaign[0] : available[0]).id] },
            },
    }
  }

  // 关键校验：活动权益类表述不能只靠产品功能事实支撑
  if (needsCampaign) {
    const supporting = confirmed.filter((f) => f.type === 'campaign')
    if (!supporting.length) {
      return {
        severity: 'block',
        reason: `文案含优惠 / 金额 / 领券类表述，但绑定的事实只有产品功能类（${confirmed.map((f) => f.title).join('、')}），无法支撑该权益表述`,
        text,
        fix: availableCampaign.length
          ? {
              action: 'bind-fact',
              label: `绑定已确认的活动事实「${availableCampaign[0].title}」`,
              auto: true,
              payload: { factIds: [availableCampaign[0].id] },
            }
          : stripFix,
      }
    }
  }

  if (notSelected.length) {
    return {
      severity: 'warn',
      reason: `引用了未纳入本项目的事实：${notSelected.join(', ')}`,
      text,
      fix: { action: 'select-fact', label: `把这些事实加入本项目的已选清单`, auto: true, payload: { factIds: notSelected } },
    }
  }
  return null
}

/* ------------------------- 口播与字幕 ------------------------- */

export function checkVoPacing(shot) {
  const vo = String(shot.vo || '')
  if (!vo) return null
  const chars = countCn(vo)
  const budget = voBudget(shot.durationSec)
  if (chars > budget) {
    const suggestDuration = Math.ceil((chars / (CN_CHARS_PER_SEC * VO_SAFETY_RATIO)) * 2) / 2
    return {
      severity: 'warn',
      chars,
      budget,
      reason: `口播 ${chars} 字，${shot.durationSec}s 内建议不超过 ${budget} 字（按 ${CN_CHARS_PER_SEC} 字/秒并预留停顿）`,
      fix: {
        action: 'shorten-vo',
        label: `把口播精简到 ${budget} 字以内；或把镜头时长加到 ${suggestDuration}s（会影响总时长）`,
        auto: true,
        payload: { budget, suggestDuration },
      },
    }
  }
  return null
}

export function checkSubtitle(shot, maxLen = SUBTITLE_MAX_LEN) {
  const sub = String(shot.subtitle || '')
  if (!sub) return null
  const lines = sub.split(/[\n\r]/).filter(Boolean)
  const tooLong = lines.filter((l) => countCn(l) > maxLen)
  if (tooLong.length) {
    return {
      severity: 'warn',
      reason: `字幕单行超过 ${maxLen} 字，竖屏可读性差：${tooLong.map((l) => `"${l}"`).join(' ')}`,
      fix: {
        action: 'split-subtitle',
        label: `拆成每行不超过 ${maxLen} 字的两行，或精简表述`,
        auto: true,
        payload: { maxLen },
      },
    }
  }
  return null
}

/* ------------------------- renderMode 规则 ------------------------- */

const OVERLAY_KEYWORDS = [
  '元', '折', '%', '券', '红包', '立减', '补贴', '优惠', '免单', '首单', '新人',
  '满', '有效期', '限时', '界面', '截图', 'Logo', 'logo', 'App', 'app', 'CTA', '按钮', '价格', '预估',
]

export function checkRenderMode(shot) {
  const text = [shot.vo, shot.subtitle, (shot.overlayItems || []).join(' '), shot.actionCn].filter(Boolean).join(' ')
  const hit = OVERLAY_KEYWORDS.filter((k) => text.includes(k))
  const mode = shot.renderMode || 'ai'
  if (hit.length && mode === 'ai') {
    return {
      severity: 'block',
      reason: `该镜头涉及优惠 / 界面 / Logo / 价格 / CTA 等精确信息（命中：${hit.slice(0, 5).join('、')}），必须用 overlay 后期叠加或 asset 已确认素材，不能交给视频模型直接生成`,
      fix: {
        action: 'set-render-mode',
        label: '把生成方式改为「AI + 后期叠加」，文字与界面交由 ffmpeg 精确合成',
        auto: true,
        payload: { renderMode: 'overlay' },
      },
    }
  }
  return null
}

/* ------------------------- 官方素材就绪 ------------------------- */

export function checkOfficialAssets(shot, picked) {
  const all = Object.values(picked).flat()
  const missing = (shot.uiRefs || [])
    .map((id) => all.find((a) => a.id === id))
    .filter((a) => a && (a.tags || []).includes('official-required') && !a.refImage)
  if (missing.length) {
    const names = missing.map((a) => a.nameCn || a.name).join('、')
    const hasUi = missing.some((a) => a.category === 'productUI')
    return {
      severity: 'block',
      reason: `该镜头引用的官方素材尚未上传：${names}。App 界面与 Logo 禁止 AI 生成，必须先上传真实素材`,
      fix: {
        action: 'remove-asset-ref',
        label: hasUi
          ? `推荐做法：在 Phase 1 上传「${names}」的真实截图/录屏。若本次先不展示界面，可一键移除该镜头对它的引用并同步调整文案`
          : `推荐做法：在 Phase 1 上传「${names}」。也可一键移除该引用`,
        auto: true,
        payload: { assetIds: missing.map((a) => a.id) },
        preferManual: true,
      },
    }
  }
  return null
}

/* ------------------------- 汇总校验 ------------------------- */

export function validateStoryboard({ project, brandGuide, compliance, factLib, picked, channel }) {
  const sb = project.storyboard
  if (!sb) return { shots: [], summary: { blockers: 0, warnings: 0 }, global: [] }

  const global = []
  const perShot = []

  const total = sb.shots.reduce((a, s) => a + (Number(s.durationSec) || 0), 0)
  const target = project.brief?.durationSec || brandGuide.format?.defaultDuration || 15
  if (Math.abs(total - target) > 1.5) {
    global.push({
      type: 'global',
      severity: 'warn',
      reason: `分镜总时长 ${total.toFixed(1)}s 与目标 ${target}s 偏差较大`,
      fix: {
        action: 'rebalance-duration',
        label: `按比例调整各镜头时长，使总时长等于 ${target}s`,
        auto: true,
        payload: { target },
      },
    })
  }
  if (channel?.recommendedDuration) {
    const [lo, hi] = channel.recommendedDuration
    if (total < lo || total > hi) {
      global.push({
        type: 'global',
        severity: 'warn',
        reason: `${channel.name} 建议时长 ${lo}-${hi}s，当前 ${total.toFixed(1)}s`,
        fix: { action: 'rebalance-duration', label: `调整到 ${lo}-${hi}s 区间`, auto: true, payload: { target: Math.min(Math.max(total, lo), hi) } },
      })
    }
  }

  if (!sb.shots.some((s) => s.role === 'cta')) {
    global.push({
      type: 'global',
      severity: 'block',
      reason: '缺少 CTA 镜头，广告必须有明确的行动引导',
      fix: {
        action: 'set-role',
        label: '把最后一个镜头的作用设为「CTA 行动引导」，并补上 CTA 文案与 Logo 叠加',
        auto: true,
        payload: { shotIndex: sb.shots.length, role: 'cta' },
      },
    })
  }

  const first = sb.shots[0]
  if (first && first.role !== 'hook') {
    global.push({
      type: 'global',
      severity: 'warn',
      reason: '第一个镜头不是 hook 角色，前 3 秒钩子可能不够明确',
      fix: { action: 'set-role', label: '把第一个镜头的作用设为「开头钩子」', auto: true, payload: { shotIndex: 1, role: 'hook' } },
    })
  }

  const facts = (project.facts || []).map((id) => (factLib.facts || []).find((f) => f.id === id)).filter(Boolean)
  const unusable = facts.filter(f => !usableFact(f))
  if (unusable.length) {
    global.push({
      type: 'global',
      severity: 'warn',
      reason: `已选事实中有 ${unusable.length} 条未确认、不在有效期内或日期待补充，不可在素材中表达：${unusable.map((f) => f.title).join('、')}`,
      fix: {
        action: 'deselect-fact',
        label: '从本项目移除这些未确认事实（或去 Phase 1 补齐后标为已确认）',
        auto: true,
        payload: { factIds: unusable.map((f) => f.id) },
      },
    })
  }

  for (const shot of sb.shots) {
    const issues = []

    const cHits = scanCompliance(compliance, [
      { label: '口播', field: 'vo', text: shot.vo },
      { label: '字幕', field: 'subtitle', text: shot.subtitle },
      { label: '叠加内容', field: 'overlayItems', text: (shot.overlayItems || []).join(' ') },
    ])
    for (const h of cHits) {
      issues.push({
        type: 'compliance',
        severity: h.severity,
        reason: `${h.where}命中${h.ruleName}「${h.term}」— ${h.basis}`,
        term: h.term,
        fix: {
          action: 'rewrite-copy',
          label: COMPLIANCE_FIX_HINT[h.ruleId] || '改写文案，删除违规表述',
          auto: true,
          payload: { field: h.field, term: h.term, ruleId: h.ruleId },
        },
      })
    }

    const fb = checkFactBinding(compliance, factLib, project, shot)
    if (fb) issues.push({ type: 'fact', ...fb })

    const rm = checkRenderMode(shot)
    if (rm) issues.push({ type: 'renderMode', ...rm })

    const oa = checkOfficialAssets(shot, picked)
    if (oa) issues.push({ type: 'asset', ...oa })

    const vp = checkVoPacing(shot)
    if (vp) issues.push({ type: 'vo', ...vp })

    const st = checkSubtitle(shot)
    if (st) issues.push({ type: 'subtitle', ...st })

    perShot.push({ shotId: shot.id, index: shot.index, role: shot.role, issues })
  }

  const allIssues = [...global, ...perShot.flatMap((s) => s.issues)]
  const blockers = allIssues.filter((i) => i.severity === 'block')
  return {
    shots: perShot,
    global,
    summary: {
      blockers: blockers.length,
      warnings: allIssues.filter((i) => i.severity === 'warn').length,
      autoFixable: allIssues.filter((i) => i.fix?.auto).length,
      manualOnly: allIssues.filter((i) => i.fix && !i.fix.auto).length,
      needsUpload: allIssues.filter((i) => i.type === 'asset').length,
      totalDuration: total,
    },
  }
}

/* ------------------------- 影响面分析 ------------------------- */

export function analyzeImpact({ project, changedFactIds = [], globalContextChanged = false }) {
  const sb = project.storyboard
  if (!sb) return { shots: [], variants: [], note: '尚无分镜' }

  const affected = sb.shots.filter((s) => {
    if (globalContextChanged) return true
    return (s.factRefs || []).some((id) => changedFactIds.includes(id))
  })

  const variants = (project.variants || []).filter((v) =>
    globalContextChanged ? true : (v.shots || []).some((s) => (s.factRefs || []).some((id) => changedFactIds.includes(id))),
  )

  return {
    shots: affected.map((s) => ({
      id: s.id,
      index: s.index,
      role: s.role,
      titleCn: s.titleCn,
      reason: globalContextChanged
        ? '全局分镜上下文已修改'
        : `引用了被修改的事实：${(s.factRefs || []).filter((id) => changedFactIds.includes(id)).join(', ')}`,
      hasRender: Boolean(project.render?.shots?.[s.id]?.url),
    })),
    variants: variants.map((v) => ({ id: v.id, name: v.variantName })),
    note: affected.length
      ? `有 ${affected.length} 个镜头需要复核${variants.length ? `，另有 ${variants.length} 个测试变体受影响` : ''}`
      : '没有镜头受影响',
  }
}
