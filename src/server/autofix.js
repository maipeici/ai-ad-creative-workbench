/**
 * 自动修复引擎
 * ---------------------------------------------------------------
 * 把 validate.js 报出的问题真正改掉，而不是只提示。
 *
 * 分两类执行：
 *  A. 确定性修复（不需要模型）：renderMode、镜头作用、事实绑定、时长再平衡、
 *     字幕换行、移除未就绪素材引用。
 *  B. 文案改写（需要模型）：合规违规词、口播超长。统一收集后一次性交给
 *     Gemini 重写，未配置模型时用确定性兜底规则（删词 + 截断）。
 *
 * 所有修复都遵守系统三条硬规则：不编造金额、精确信息不入模型、合规前置。
 */

import { countCn, voBudget, SUBTITLE_MAX_LEN } from './validate.js'
import { llmJson } from './providers/llm.js'

/* ---------------- 确定性兜底：删除违规词 ---------------- */

/** 无模型时的兜底改写：删除违规词并做基本通顺处理 */
function stripTerms(text, terms) {
  let out = String(text || '')
  for (const t of terms) {
    out = out.split(t).join('')
  }
  return out
    .replace(/[，,、]{2,}/g, '，')
    .replace(/^[，,、。！!？?\s]+/, '')
    .replace(/[，,、]+([。！!？?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** 删除金额与活动类表述（无已确认活动事实时的兜底） */
/** 分镜 prompt 里描述「绿幕 / 色键占位屏」的写法 */
const GREEN_SCREEN_PATTERN = /(green\s*screen|chroma[\s-]?key|solid\s+green|blank\s+green|tracking\s+marker)/i

const CLAIM_PATTERNS = [
  /\d+(\.\d+)?\s*元/g,
  /\d+(\.\d+)?\s*折/g,
  /\d+(\.\d+)?\s*块/g,
  /\d+(\.\d+)?\s*%/g,
  /满\s*\d+(\.\d+)?/g,
  /立减\s*\d*/g,
  /最高可省\s*\d*/g,
  /新人券|优惠券|领券|抵扣|红包|补贴|免单|首单立减/g,
  /再省一笔|省一笔|省钱/g,
  /限时|有效期/g,
]

/** 清理残留的悬空动词短语（删词后容易留下"现在还能"这类半句） */
const DANGLING = [
  /现在[，,]?还能[。，,]?/g,
  /还能再?[。，,]/g,
  /领取[，,。]?$/g,
  /^还能/g,
]

function tidy(text) {
  return String(text || '')
    .replace(/[，,、]{2,}/g, '，')
    .replace(/^[，,、。！!？?\s]+/, '')
    .replace(/[，,、]+([。！!？?])/g, '$1')
    .replace(/[，,、。]{2,}/g, '。')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function stripClaims(text) {
  let out = String(text || '')
  for (const re of CLAIM_PATTERNS) out = out.replace(re, '')
  for (const re of DANGLING) out = out.replace(re, '')
  out = tidy(out)
  // 删干净后只剩标点则整句清空，交由后续按镜头作用补默认文案
  if (!/[\u4e00-\u9fa5a-zA-Z0-9]/.test(out)) return ''
  return out
}

/** 从品牌规范里挑一条不含优惠表述的 CTA（无已确认活动事实时使用） */
export function pickSafeCta(brandGuide, preferredId, hasCampaignFact) {
  const opts = brandGuide?.ctaOptions || []
  const claimRe = /券|红包|优惠|立减|免单|省/
  const preferred = opts.find((c) => c.id === preferredId)
  if (preferred && (hasCampaignFact || !claimRe.test(preferred.text))) return preferred.text
  const safe = opts.find((c) => !claimRe.test(c.text))
  return safe?.text || '打开花小猪打车'
}

/** 按预算截断中文文案（优先在标点处断句，且不切断英文单词） */
function truncateCn(text, budget) {
  const s = String(text || '')
  if (countCn(s) <= budget) return s

  // 优先在标点处截断
  const marks = ['。', '！', '？', '，', '、', '；']
  let best = ''
  let acc = ''
  for (const ch of s) {
    acc += ch
    if (marks.includes(ch) && countCn(acc) <= budget) best = acc
  }
  if (best) return best.replace(/[，、；]$/, '。')

  // 硬截断：退到不切断英文单词的位置
  let out = ''
  for (const ch of s) {
    if (countCn(out + ch) > budget) break
    out += ch
  }
  let end = out.length
  while (end > 0 && /[a-zA-Z0-9]/.test(s[end - 1]) && end < s.length && /[a-zA-Z0-9]/.test(s[end])) {
    end--
  }
  out = s.slice(0, end)
  return out.replace(/[，、；\s]+$/, '') + '。'
}

const WORD_CHAR = /[a-zA-Z0-9]/

/** 断点是否切在英文单词或数字中间 */
function breaksWord(s, i) {
  return i > 0 && i < s.length && WORD_CHAR.test(s[i - 1]) && WORD_CHAR.test(s[i])
}

/** 把断点移出英文单词内部（优先往前找边界） */
function safeCut(s, i) {
  if (!breaksWord(s, i)) return i
  for (let d = 1; d < s.length; d++) {
    if (i - d >= 0 && !breaksWord(s, i - d)) return i - d
    if (i + d <= s.length && !breaksWord(s, i + d)) return i + d
  }
  return i
}

/** 字幕拆行：不在英文单词中间断开 */
function splitSubtitle(text, maxLen = SUBTITLE_MAX_LEN) {
  const s = String(text || '').replace(/[\n\r]+/g, '')
  if (countCn(s) <= maxLen) return s

  const marks = ['，', '、', '。', '；', '？', '！', ' ', ',']
  const mid = Math.floor(s.length / 2)

  // 优先在靠中间的标点处断
  let cut = -1
  for (let d = 0; d < s.length; d++) {
    for (const i of [mid - d, mid + d]) {
      if (i > 0 && i < s.length && marks.includes(s[i])) {
        cut = i + 1
        break
      }
    }
    if (cut > 0) break
  }
  if (cut < 0) cut = safeCut(s, mid)

  const l1 = s.slice(0, cut).replace(/[，、；,\s]+$/, '')
  const l2 = s.slice(cut).replace(/^[，、；,\s]+/, '')
  const clean = (x) => truncateCn(x, maxLen).replace(/[。，、；]$/, '')
  return `${clean(l1)}\n${clean(l2)}`
}

/* ---------------- LLM 文案改写 ---------------- */

function rewriteMessages({ brandGuide, compliance, facts, tasks }) {
  const blocking = (compliance.rules || []).filter((r) => r.severity === 'block')
  const usable = facts.confirmed.map((f) => ({
    id: f.id,
    title: f.title,
    statement: f.statement,
    amount: f.couponAmount,
    threshold: f.threshold,
  }))

  const system = [
    '你是花小猪打车的广告文案合规改写专家。',
    '你的任务：把违反广告法或超出时长的口播与字幕改写成合规、自然、口语化的版本。',
    '铁律一：绝不使用极限词与绝对化用语（最、第一、唯一、绝对、保证、百分百、全网最低等）。',
    '铁律二：绝不编造任何优惠金额、门槛、折扣、用户评价、销量。只能使用下方「可用事实」中已确认的内容；若没有可用的活动事实，就改为只讲产品通用功能，删除所有金额与活动表述。',
    '铁律三：严格遵守字数预算，中文口播约 5 字/秒，必须能在镜头时长内自然念完。',
    '改写时保留原文案的沟通意图与语气，不要变成生硬的说明书。',
    'Return ONLY raw JSON. No markdown fences.',
  ].join('\n')

  const user = [
    '# 禁止使用的表述（命中即被平台拒审）',
    ...blocking.map((r) => `- ${r.name}：${r.terms.slice(0, 14).join(' / ')}`),
    '',
    '# 可用事实（只有这些内容可以作为卖点依据）',
    usable.length
      ? usable.map((f) => `- [${f.id}] ${f.title}：${f.statement}${f.amount ? ` | 金额 ${f.amount}` : ''}${f.threshold ? ` | 门槛 ${f.threshold}` : ''}`).join('\n')
      : '（无已确认的活动事实 —— 因此所有金额、券、红包、立减、首单优惠类表述都必须删除，改为讲产品功能）',
    '',
    '# 文案规范',
    ...(brandGuide.copyRules || []).map((r) => `- ${r}`),
    '',
    '# 待改写的镜头',
    JSON.stringify(tasks, null, 2),
    '',
    '# 要求',
    '对每个镜头输出改写后的 vo（口播）与 subtitle（字幕）。',
    'vo 的中文字数必须 ≤ voBudget；subtitle 单行中文字数必须 ≤ subtitleMaxLen（超过则用 \\n 拆成两行）。',
    '若某镜头原本无口播或无字幕，保持为空字符串。',
    'reason 字段用中文说明你改了什么、为什么。',
    '',
    '# 输出 JSON',
    JSON.stringify(
      {
        fixes: [
          { index: 1, vo: '改写后的中文口播', subtitle: '改写后的中文字幕', reason: '中文说明改动' },
        ],
      },
      null,
      2,
    ),
  ].join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/** 兜底改写（无模型时） */
function mockRewrite({ tasks, hasUsableFact }) {
  return {
    fixes: tasks.map((t) => {
      let vo = t.vo || ''
      let subtitle = t.subtitle || ''
      if (t.violatingTerms?.length) {
        vo = stripTerms(vo, t.violatingTerms)
        subtitle = stripTerms(subtitle, t.violatingTerms)
      }
      if (t.needStripClaim && !hasUsableFact) {
        vo = stripClaims(vo)
        subtitle = stripClaims(subtitle)
      }
      if (vo && countCn(vo) > t.voBudget) vo = truncateCn(vo, t.voBudget)
      if (subtitle && countCn(subtitle) > t.subtitleMaxLen) subtitle = splitSubtitle(subtitle, t.subtitleMaxLen)
      return {
        index: t.index,
        vo,
        subtitle,
        reason: '已删除违规表述并按时长预算精简（规则兜底改写，未使用模型）',
      }
    }),
  }
}

/* ---------------- 主入口 ---------------- */

/**
 * 执行自动修复。
 * @returns { project, report }
 */
export async function autoFix({ project, brandGuide, compliance, factLib, facts, picked, validation, options = {} }) {
  const sb = project.storyboard
  if (!sb) throw new Error('尚无分镜')

  const report = { applied: [], skipped: [], needsManual: [] }
  const sharedFacts = Boolean(project.batchId || project.creatives?.length || project.batch?.items?.length > 1)
  const byIndex = new Map(sb.shots.map((s) => [s.index, s]))
  const shotById = new Map(sb.shots.map((s) => [s.id, s]))

  // 项目内是否存在已确认的活动事实 —— 决定能否表达优惠权益
  const hasCampaignFact = facts.confirmed.some((f) => f.type === 'campaign')

  // 允许只修某一个镜头
  const scopeShotId = options.shotId || null
  const inScope = (shotId) => !scopeShotId || shotId === scopeShotId

  /* ---------- A. 全局问题 ---------- */
  for (const g of validation.global) {
    if (scopeShotId) continue
    if (!g.fix?.auto) {
      report.needsManual.push({ scope: '全局', reason: g.reason, label: g.fix?.label })
      continue
    }
    switch (g.fix.action) {
      case 'set-role': {
        const shot = byIndex.get(g.fix.payload.shotIndex)
        if (shot) {
          shot.role = g.fix.payload.role
          if (shot.role === 'cta') {
            // CTA 文案必须与事实状态匹配：无已确认活动事实时不得出现「领券」类表述
            const safeCta = pickSafeCta(brandGuide, project.brief?.cta, hasCampaignFact)
            if (!shot.subtitle || /券|红包|立减|免单/.test(shot.subtitle)) shot.subtitle = safeCta
            const logo = Object.values(picked).flat().find((a) => a.id === 'brand-logo-main' && a.refImage)
            if (logo && !(shot.uiRefs || []).includes(logo.id)) {
              shot.uiRefs = [...(shot.uiRefs || []), logo.id]
            }
            shot.overlayItems = ['品牌 Logo', 'CTA 文案', '字幕']
            shot.renderMode = 'overlay'
            report.applied.push({
              scope: `镜头 #${shot.index}`,
              action: 'set-role',
              detail: `作用设为 CTA，补上 Logo 叠加与合规 CTA 文案「${shot.subtitle}」`,
            })
          } else {
            report.applied.push({ scope: `镜头 #${shot.index}`, action: 'set-role', detail: `作用设为 ${shot.role}` })
          }
        }
        break
      }
      case 'rebalance-duration': {
        const target = g.fix.payload.target
        const cur = sb.shots.reduce((a, s) => a + (Number(s.durationSec) || 0), 0)
        if (cur > 0) {
          const k = target / cur
          let acc = 0
          sb.shots.forEach((s, i) => {
            if (i === sb.shots.length - 1) {
              s.durationSec = Math.max(2, Math.round((target - acc) * 10) / 10)
            } else {
              s.durationSec = Math.max(2, Math.round(s.durationSec * k * 2) / 2)
              acc += s.durationSec
            }
          })
          report.applied.push({ scope: '全局', action: 'rebalance-duration', detail: `总时长调整为 ${target}s` })
        }
        break
      }
      case 'deselect-fact': {
        const ids = g.fix.payload.factIds || []
        if (sharedFacts) {
          report.needsManual.push({ scope: '品牌素材', reason: '这批素材共用事实选用，请先在品牌素材中移除未确认事实，再重新审核。', action: 'deselect-fact', factIds: ids })
          break
        }
        project.facts = (project.facts || []).filter((id) => !ids.includes(id))
        for (const s of sb.shots) s.factRefs = (s.factRefs || []).filter((id) => !ids.includes(id))
        report.applied.push({ scope: '全局', action: 'deselect-fact', detail: `移除未确认事实 ${ids.length} 条` })
        break
      }
      default:
        report.skipped.push({ scope: '全局', reason: g.reason, action: g.fix.action })
    }
  }

  /* ---------- B. 镜头级确定性修复 ---------- */
  const rewriteTasks = []

  for (const sv of validation.shots) {
    if (!inScope(sv.shotId)) continue
    const shot = shotById.get(sv.shotId)
    if (!shot) continue

    let needRewrite = false
    const violatingTerms = []
    let needStripClaim = false

    for (const iss of sv.issues) {
      if (!iss.fix) continue

      // 素材未上传：优先提示人工上传，但按用户选择可自动移除引用
      if (iss.type === 'asset') {
        if (options.removeMissingAssets) {
          const ids = iss.fix.payload.assetIds || []
          shot.uiRefs = (shot.uiRefs || []).filter((id) => !ids.includes(id))
          // 同步清掉相关叠加项描述
          shot.overlayItems = (shot.overlayItems || []).filter((o) => !/界面|截图|App|app/.test(o))
          if (!(shot.overlayItems || []).length && !shot.subtitle) shot.renderMode = 'ai'
          report.applied.push({
            scope: `镜头 #${shot.index}`,
            action: 'remove-asset-ref',
            detail: `移除未上传的官方素材引用（${ids.length} 项）`,
          })
        } else {
          report.needsManual.push({
            scope: `镜头 #${shot.index}`,
            reason: iss.reason,
            label: iss.fix.label,
            action: 'upload-asset',
            assetIds: iss.fix.payload.assetIds,
          })
        }
        continue
      }

      switch (iss.fix.action) {
        case 'set-render-mode':
          shot.renderMode = iss.fix.payload.renderMode
          report.applied.push({ scope: `镜头 #${shot.index}`, action: 'set-render-mode', detail: `生成方式改为 ${shot.renderMode}` })
          break

        case 'bind-fact': {
          const ids = iss.fix.payload.factIds || []
          shot.factRefs = [...new Set([...(shot.factRefs || []), ...ids])]
          report.applied.push({ scope: `镜头 #${shot.index}`, action: 'bind-fact', detail: `绑定事实 ${ids.join(', ')}` })
          break
        }

        case 'select-fact': {
          const ids = iss.fix.payload.factIds || []
          if (sharedFacts) {
            report.needsManual.push({ scope: '品牌素材', reason: '请先在品牌素材中选用所需事实，再重新审核；单条修复不修改整批资料。', action: 'select-fact', factIds: ids })
            break
          }
          project.facts = [...new Set([...(project.facts || []), ...ids])]
          report.applied.push({ scope: '全局', action: 'select-fact', detail: `将 ${ids.join(', ')} 加入项目` })
          break
        }

        case 'strip-claim':
          needStripClaim = true
          needRewrite = true
          break

        case 'rewrite-copy':
          if (iss.fix.payload?.term) violatingTerms.push(iss.fix.payload.term)
          needRewrite = true
          break

        case 'shorten-vo':
          needRewrite = true
          break

        case 'split-subtitle':
          shot.subtitle = splitSubtitle(shot.subtitle, iss.fix.payload.maxLen)
          report.applied.push({ scope: `镜头 #${shot.index}`, action: 'split-subtitle', detail: '字幕已拆行' })
          break

        default:
          report.skipped.push({ scope: `镜头 #${shot.index}`, reason: iss.reason, action: iss.fix.action })
      }
    }

    if (needRewrite) {
      rewriteTasks.push({
        index: shot.index,
        role: shot.role,
        durationSec: shot.durationSec,
        voBudget: voBudget(shot.durationSec),
        subtitleMaxLen: SUBTITLE_MAX_LEN,
        vo: shot.vo || '',
        subtitle: shot.subtitle || '',
        violatingTerms: [...new Set(violatingTerms)],
        needStripClaim,
      })
    }
  }

  /* ---------- C. 文案改写 ---------- */
  let rewriteSource = null
  if (rewriteTasks.length) {
    const messages = rewriteMessages({ brandGuide, compliance, facts, tasks: rewriteTasks })
    const { data, source } = await llmJson(messages, () =>
      mockRewrite({ tasks: rewriteTasks, hasUsableFact: hasCampaignFact }),
    )
    rewriteSource = source

    // 无已确认活动事实时的安全兜底文案，按镜头作用给
    const fallbackCopy = {
      hook: { vo: '下班高峰又打不到车。', subtitle: '下班高峰打不到车' },
      scene: { vo: '以前只能干等着。', subtitle: '以前只能干等着' },
      product: { vo: '现在用花小猪，一键就能叫。', subtitle: '一键叫车很方便' },
      proof: { vo: '下单前还能看预估价。', subtitle: '行前可看预估价' },
      cta: { vo: '你也打开试试。', subtitle: pickSafeCta(brandGuide, project.brief?.cta, hasCampaignFact) },
    }

    for (const fx of data.fixes || []) {
      const shot = byIndex.get(fx.index)
      if (!shot) continue

      let vo = String(fx.vo ?? shot.vo ?? '')
      let subtitle = String(fx.subtitle ?? shot.subtitle ?? '')

      // 双保险：模型输出仍要过一遍确定性兜底
      const task = rewriteTasks.find((t) => t.index === fx.index)
      if (task?.violatingTerms?.length) {
        vo = stripTerms(vo, task.violatingTerms)
        subtitle = stripTerms(subtitle, task.violatingTerms)
      }
      // 无已确认活动事实 → 任何镜头都不得留下优惠类表述
      if (!hasCampaignFact) {
        vo = stripClaims(vo)
        subtitle = stripClaims(subtitle)
      }
      if (vo && countCn(vo) > voBudget(shot.durationSec)) vo = truncateCn(vo, voBudget(shot.durationSec))
      if (subtitle && countCn(subtitle.replace(/\n/g, '')) > SUBTITLE_MAX_LEN) subtitle = splitSubtitle(subtitle)

      // 清空后按镜头作用补一句安全文案，避免出现空白镜头
      const fb = fallbackCopy[shot.role] || fallbackCopy.scene
      if (!vo && task?.vo) vo = truncateCn(fb.vo, voBudget(shot.durationSec))
      if (!subtitle && task?.subtitle) subtitle = fb.subtitle

      shot.vo = vo
      shot.subtitle = subtitle

      report.applied.push({
        scope: `镜头 #${shot.index}`,
        action: 'rewrite-copy',
        detail: fx.reason || '文案已改写',
        before: { vo: task?.vo, subtitle: task?.subtitle },
        after: { vo, subtitle },
      })
    }
  }

  /* ---------- D. 收尾一致性 ---------- */
  const confirmedIds = facts.confirmed.map((f) => f.id)
  const campaignIds = facts.confirmed.filter((f) => f.type === 'campaign').map((f) => f.id)

  for (const shot of sb.shots) {
    // 0) prompt 里的绿幕描述必须清除：
    //    手机界面是后期叠加的，画面里出现绿幕/纯色占位屏会直接穿帮且无法自然合成。
    const beforePrompt = shot.prompt
    if (beforePrompt && GREEN_SCREEN_PATTERN.test(beforePrompt)) {
      shot.prompt = beforePrompt
        .replace(/blank\s+green\s+screen[^.,]*/gi, 'a plain dark switched-off display')
        .replace(/green\s+screen[^.,]*/gi, 'dark switched-off display')
        .replace(/chroma[\s-]?key[^.,]*/gi, 'dark switched-off display')
        .replace(/solid\s+green[^.,]*/gi, 'dark display')
        .replace(/(,\s*)+/g, ', ')
        .replace(/\s+/g, ' ')
        .trim()
    }
    if (shot.prompt !== beforePrompt) {
      const neg = shot.negativePrompt || ''
      shot.negativePrompt = /green screen/i.test(neg) ? neg : `${neg}, green screen, chroma key`.replace(/^,\s*/, '')
      report.applied.push({
        scope: `镜头 #${shot.index}`,
        action: 'fix-green-screen-prompt',
        detail: '手机界面由后期叠加，画面不能出绿幕；已把屏幕改为关机深色屏',
        before: { prompt: beforePrompt },
        after: { prompt: shot.prompt },
      })
    }

    // 1) 只保留有效的事实绑定
    shot.factRefs = (shot.factRefs || []).filter((id) => confirmedIds.includes(id))

    const textOf = () => [shot.vo, shot.subtitle, (shot.overlayItems || []).join(' ')].join(' ')
    const hasClaim = () =>
      CLAIM_PATTERNS.some((re) => {
        re.lastIndex = 0
        return re.test(textOf())
      })

    // 2) 最后一道闸：仍有优惠表述但无活动事实支撑 → 强制清除表述
    if (hasClaim() && !campaignIds.length) {
      const beforeVo = shot.vo
      const beforeSub = shot.subtitle
      shot.vo = stripClaims(shot.vo)
      shot.subtitle = stripClaims(shot.subtitle)
      shot.overlayItems = (shot.overlayItems || []).filter((o) => !/优惠|券|红包|立减|金额/.test(o))
      if (!shot.vo && beforeVo) shot.vo = shot.role === 'cta' ? '你也打开试试。' : '现在用花小猪，一键就能叫。'
      if (!shot.subtitle && beforeSub) {
        shot.subtitle = shot.role === 'cta' ? pickSafeCta(brandGuide, project.brief?.cta, false) : '一键叫车很方便'
      }
      if (beforeVo !== shot.vo || beforeSub !== shot.subtitle) {
        report.applied.push({
          scope: `镜头 #${shot.index}`,
          action: 'strip-claim',
          detail: '项目内无已确认活动事实，已清除优惠 / 领券类表述',
          before: { vo: beforeVo, subtitle: beforeSub },
          after: { vo: shot.vo, subtitle: shot.subtitle },
        })
      }
    }

    // 3) 有优惠表述且有活动事实 → 确保绑定上
    if (hasClaim() && campaignIds.length && !shot.factRefs.some((id) => campaignIds.includes(id))) {
      shot.factRefs = [...new Set([...shot.factRefs, campaignIds[0]])]
      report.applied.push({
        scope: `镜头 #${shot.index}`,
        action: 'bind-fact',
        detail: `优惠表述已绑定活动事实 ${campaignIds[0]}`,
      })
    }

    // 4) overlay 镜头必须有内容可叠加
    if (shot.renderMode === 'overlay' && !(shot.overlayItems || []).length) {
      shot.overlayItems = shot.subtitle ? ['字幕'] : []
      if (!shot.overlayItems.length) shot.renderMode = 'ai'
    }
    // 5) 有字幕/界面/Logo 的镜头不能是纯 ai
    if (shot.renderMode === 'ai' && (shot.subtitle || (shot.uiRefs || []).length)) {
      shot.renderMode = 'overlay'
      if (!(shot.overlayItems || []).length) shot.overlayItems = ['字幕']
    }
  }

  report.rewriteSource = rewriteSource
  return { project, report }
}
