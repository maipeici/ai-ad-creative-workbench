/**
 * 花小猪广告短视频 · Prompt 模板引擎
 * ---------------------------------------------------------------
 * 工作流的核心资产。把「品牌规范 + 素材库 + 产品事实 + 渠道规格 +
 * 内容需求 + 创意 + 分镜」稳定编译成可消费的结构化指令。
 *
 * 三条硬规则贯穿全文件：
 *  1. 事实绑定：任何金额/门槛/时间类表述必须引用 product-facts 中 confirmed 的条目
 *  2. 文字不入模型：优惠、界面、Logo、CTA 一律 renderMode=overlay 后期叠加
 *  3. 合规前置：极限词与绝对化表述在生成阶段即被禁止
 */

const j = (v) => JSON.stringify(v, null, 2)

function dedupe(arr) {
  const seen = new Set()
  const out = []
  for (const raw of arr) {
    const v = String(raw || '').trim()
    if (!v) continue
    const k = v.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(v)
  }
  return out
}

/* ------------------------- 素材解析 ------------------------- */

export function resolveAssets(project, assetLib) {
  const byId = new Map(assetLib.items.map((i) => [i.id, i]))
  const picked = {}
  for (const cat of assetLib.categories) {
    const ids = project.assets?.[cat.id] || []
    picked[cat.id] = ids.map((id) => byId.get(id)).filter(Boolean)
  }
  return picked
}

export function assetNegatives(picked) {
  return Object.values(picked)
    .flat()
    .map((a) => a.negative)
    .filter(Boolean)
}

/** 已选素材中缺少官方素材文件的项（必须上传才能生产） */
export function missingOfficialAssets(picked) {
  return Object.values(picked)
    .flat()
    .filter((a) => (a.tags || []).includes('official-required') && !a.refImage)
}

/* ------------------------- 事实解析 ------------------------- */

export function resolveFacts(project, factLib) {
  const byId = new Map(factLib.facts.map((f) => [f.id, f]))
  const ids = project.facts || []
  const selected = ids.map((id) => byId.get(id)).filter(Boolean)
  return {
    all: selected,
    confirmed: selected.filter((f) => f.status === 'confirmed'),
    unusable: selected.filter((f) => f.status !== 'confirmed'),
  }
}

/* ------------------------- 负向 Prompt ------------------------- */

export function composeNegativePrompt(brandGuide, picked, extra = []) {
  const lib = brandGuide.negativePromptLibrary || {}
  const parts = [
    ...(lib.identity || []),
    ...(lib.vehicle || []),
    ...(lib.style || []),
    ...(lib.text || []),
    ...(lib.quality || []),
    ...(lib.safety || []),
    ...(lib.brand || []),
    ...assetNegatives(picked),
    ...extra,
  ]
  return dedupe(parts).join(', ')
}

/* ------------------------- 上下文块 ------------------------- */

export function brandBlock(brandGuide, channel) {
  const bi = brandGuide.brandIdentity || {}
  const sa = channel?.safeArea
  return [
    `# BRAND & PRODUCTION RULES (Phase 1 - immutable)`,
    `Product: ${bi.productName} (${bi.productNameEn}) — ${bi.category}`,
    `Positioning: ${bi.positioning}`,
    `Format: ${brandGuide.format?.aspectRatio} vertical, ${brandGuide.format?.resolution}, ${brandGuide.format?.fps}fps, duration ${brandGuide.format?.durationRange?.join('-')}s`,
    channel ? `Channel: ${channel.name} | recommended ${channel.recommendedDuration?.join('-')}s` : '',
    sa
      ? `Safe area: keep key subject and all text away from top ${Math.round(sa.top * 100)}%, bottom ${Math.round(sa.bottom * 100)}%, left ${Math.round(sa.left * 100)}%, right ${Math.round(sa.right * 100)}% — ${sa.note}`
      : '',
    channel?.firstFrameRule ? `First frame: ${channel.firstFrameRule}` : '',
    channel?.audioRule ? `Audio context: ${channel.audioRule}` : '',
    ``,
    `Visual style: ${brandGuide.visualStyle?.label} -> ${(brandGuide.visualStyle?.promptFragments || []).join(', ')}`,
    `Style intent: ${brandGuide.visualStyle?.description}`,
    `Camera style: ${brandGuide.cameraStyle?.label}`,
    `Allowed camera angles: ${(brandGuide.cameraStyle?.defaultAngles || []).join(' | ')}`,
    `Allowed camera movements: ${(brandGuide.cameraStyle?.defaultMovements || []).join(' | ')}`,
    `Lighting presets: ${(brandGuide.lighting?.presets || []).map((p) => `${p.id}=${p.prompt}`).join(' | ')}`,
    ``,
    `## HARD RESTRICTIONS (violating any of these makes the material unusable)`,
    ...(brandGuide.restrictions || []).map((r) => `- ${r}`),
    ``,
    `## PRODUCT DISPLAY RULES`,
    ...(brandGuide.productDisplayRules || []).map((r) => `- ${r}`),
    ``,
    `## COPY RULES`,
    ...(brandGuide.copyRules || []).map((r) => `- ${r}`),
  ]
    .filter(Boolean)
    .join('\n')
}

export function complianceBlock(compliance) {
  const blocking = (compliance.rules || []).filter((r) => r.severity === 'block')
  const warning = (compliance.rules || []).filter((r) => r.severity === 'warn')
  return [
    '# ADVERTISING COMPLIANCE (Chinese Advertising Law + platform review rules)',
    'The following expressions are FORBIDDEN in voiceover, subtitle, on-screen text and CTA. Using any of them makes the ad rejected by the platform.',
    ...blocking.map((r) => `- [${r.name}] ${r.terms.slice(0, 14).join(' / ')}`),
    '',
    'The following require a confirmed factual basis, avoid unless backed by a fact entry:',
    ...warning.map((r) => `- [${r.name}] ${r.terms.slice(0, 10).join(' / ')}`),
    '',
    'MUST NOT invent: coupon amounts, discount rates, user counts, ratings, sales figures, city coverage, service guarantees.',
  ].join('\n')
}

export function factBlock(facts) {
  const lines = ['# CONFIRMED PRODUCT FACTS (the ONLY source of truth for claims)']
  if (!facts.confirmed.length) {
    lines.push('(no confirmed fact selected — you MUST NOT state any feature, benefit, coupon, price or campaign claim)')
  } else {
    for (const f of facts.confirmed) {
      const bits = [
        `- [${f.id}] (${f.type}) ${f.title}: ${f.statement}`,
        f.couponAmount && !String(f.couponAmount).includes('待补充') ? `    amount: ${f.couponAmount}` : '',
        f.threshold && !String(f.threshold).includes('待补充') ? `    threshold: ${f.threshold}` : '',
        f.claimPath && !String(f.claimPath).includes('待补充') ? `    claim path: ${f.claimPath}` : '',
        f.validFrom || f.validTo ? `    valid: ${f.validFrom || '?'} ~ ${f.validTo || '?'}` : '',
        f.cities && !String(f.cities).includes('待补充') ? `    cities: ${f.cities}` : '',
        (f.conditions || []).length ? `    conditions: ${f.conditions.join('; ')}` : '',
        f.usageNote ? `    usage note: ${f.usageNote}` : '',
      ].filter(Boolean)
      lines.push(bits.join('\n'))
    }
  }
  if (facts.unusable.length) {
    lines.push('')
    lines.push('# UNUSABLE FACTS (status not confirmed — absolutely must not be mentioned)')
    for (const f of facts.unusable) lines.push(`- [${f.id}] ${f.title} (status=${f.status})`)
  }
  lines.push('')
  lines.push(
    'RULE: every voiceover/subtitle sentence that mentions a feature, benefit, coupon, amount, threshold or campaign MUST set factRefs to the fact ids it relies on. If no confirmed fact supports it, do not say it.',
  )
  return lines.join('\n')
}

export function assetBlock(picked, assetLib) {
  const labels = Object.fromEntries((assetLib?.categories || []).map((c) => [c.id, c.name]))
  const lines = ['# SELECTED ASSET REFERENCES (Phase 1 - must stay consistent across shots)']
  let any = false
  for (const [cat, items] of Object.entries(picked)) {
    if (!items.length) continue
    any = true
    lines.push(`## ${labels[cat] || cat}`)
    for (const it of items) {
      const official = (it.tags || []).includes('official-required')
      lines.push(
        `- [${it.id}] ${it.name}${it.nameCn ? ` (${it.nameCn})` : ''}` +
          (it.prompt ? ` :: ${it.prompt}` : '') +
          (it.refImage ? ' :: HAS reference image' : official ? ' :: OFFICIAL ASSET NOT UPLOADED YET' : '') +
          (official ? ' :: MUST be composited in post, never generated by the model' : ''),
      )
    }
  }
  if (!any) lines.push('(no asset selected)')
  return lines.join('\n')
}

export function briefBlock(brief, brandGuide) {
  const aud = (brandGuide.audienceOptions || []).find((a) => a.id === brief.audience)
  const scn = (brandGuide.sceneOptions || []).find((s) => s.id === brief.scene)
  const cta = (brandGuide.ctaOptions || []).find((c) => c.id === brief.cta)
  return [
    '# CONTENT BRIEF (Phase 2)',
    `Channel: ${brief.channel || 'n/a'}`,
    `Target audience: ${aud ? `${aud.name} — typical pain points: ${aud.painPoints.join(' / ')}` : brief.audience || 'n/a'}`,
    `Travel scene: ${scn ? `${scn.name} — ${scn.prompt}` : brief.scene || 'n/a'}`,
    `Campaign: ${brief.campaign || 'n/a'}`,
    `Key selling point: ${brief.sellingPoint || 'n/a'}`,
    `Conversion goal: ${brief.goal || 'n/a'}`,
    `Tone: ${brief.tone || 'relatable'}`,
    `CTA: ${cta ? `${cta.name} — "${cta.text}" (action=${cta.action})` : brief.cta || 'n/a'}`,
    `Target duration: ${brief.durationSec || 15}s`,
    `Reference / trend: ${brief.reference || 'none'}`,
    `Production constraints: ${brief.constraints || 'none'}`,
    `Extra notes: ${brief.notes || 'none'}`,
  ].join('\n')
}

export function conceptBlock(concept) {
  if (!concept) return '# CONCEPT\n(none)'
  return [
    '# APPROVED CREATIVE CONCEPT (Phase 3)',
    `Title: ${concept.title}`,
    `Core idea: ${concept.coreIdea}`,
    `Audience-scene fit: ${concept.audienceFit}`,
    `Hook (first 3s): ${concept.hook}`,
    `User pain point: ${concept.painPoint}`,
    `Selling point: ${concept.sellingPoint}  [facts: ${(concept.factRefs || []).join(', ') || 'none'}]`,
    `Product appearance: ${concept.productAppearance}`,
    `Tone: ${concept.tone}`,
    `CTA: ${concept.ctaText}`,
    `Structure: ${(concept.beats || []).map((b) => `${b.role}:${b.name}(${b.approxSec}s)`).join(' -> ')}`,
    `Recommended duration: ${concept.durationSec}s`,
  ].join('\n')
}

export function globalContextBlock(gc) {
  if (!gc) return ''
  return [
    '# GLOBAL STORYBOARD CONTEXT (Phase 4 - shared by every shot)',
    `Core idea: ${gc.coreIdea}`,
    `Conversion goal: ${gc.conversionGoal}`,
    `Audience & scene: ${gc.audienceScene}`,
    `Selling point & facts: ${gc.sellingPoint}`,
    `Person lock: ${gc.person}`,
    `Vehicle lock: ${gc.vehicle}`,
    `Scene lock: ${gc.scene}`,
    `Time & weather: ${gc.timeWeather}`,
    `Visual style: ${gc.visualStyle}`,
    `Lighting: ${gc.lighting}`,
    `Camera style: ${gc.cameraStyle}`,
    `Subtitle & VO style: ${gc.subtitleStyle}`,
    `Product UI version: ${gc.productUIVersion}`,
  ].join('\n')
}

/* ------------------------- LLM 消息构造 ------------------------- */

const JSON_RULE =
  'Return ONLY raw JSON. No markdown fences, no explanation. Fields named *Prompt or *_en must be English (for the image/video model). Fields for voiceover (vo), subtitle, ctaText, and any *Cn field must be natural spoken Simplified Chinese.'

export function conceptMessages({ brandGuide, compliance, picked, assetLib, facts, brief, channel, options = {} }) {
  const count = options.count || 3
  const structures = (brandGuide.adStructures || []).map((s) => `${s.id}: ${s.name} (${s.beats.map((b) => `${b.role}@${b.range}`).join(' > ')})`)

  const system = [
    '你是花小猪打车的资深信息流广告创意策划，服务巨量引擎 / 广点通 / 磁力智投等渠道。',
    '你产出的是 10-20 秒竖屏效果广告，目标是拉新、首单转化与老客召回，不是品牌 TVC。',
    '你极度重视三件事：前 3 秒的钩子、卖点必须有事实依据、结尾 CTA 必须明确。',
    '你从不编造优惠金额、用户评价、销量或服务承诺。没有事实支撑的卖点你会改成产品通用功能描述。',
    JSON_RULE,
  ].join('\n')

  const user = [
    brandBlock(brandGuide, channel),
    '',
    complianceBlock(compliance),
    '',
    factBlock(facts),
    '',
    assetBlock(picked, assetLib),
    '',
    briefBlock(brief, brandGuide),
    '',
    `# AVAILABLE AD STRUCTURES\n${structures.map((s) => `- ${s}`).join('\n')}`,
    '',
    options.userPreference ? `# OPERATOR CREATIVE DIRECTION\n${options.userPreference}\n` : '',
    options.avoid?.length ? `# ALREADY REJECTED (produce clearly different directions)\n${options.avoid.map((t) => `- ${t}`).join('\n')}\n` : '',
    '# TASK',
    `Generate ${count} clearly DIFFERENT ad creative concepts for this brief.`,
    `Each concept must: land the hook within the first 3 seconds, make the target audience recognise their own situation, present a selling point that is backed by a confirmed fact, and end with the specified CTA action.`,
    `Total duration must be around ${brief.durationSec || 15}s.`,
    'If the brief asks for a benefit/coupon message but no confirmed campaign fact is available, build the concept on confirmed product features instead, and say so in factWarning.',
    '',
    '# OUTPUT JSON SCHEMA',
    j({
      concepts: [
        {
          title: 'string, 中文创意标题，简短有力',
          coreIdea: 'string, 中文一句话说明这条广告讲什么',
          structureId: 'one of the available ad structure ids',
          audienceFit: 'string, 中文说明为什么这个创意适合该人群与该出行场景',
          hook: 'string, 中文描述前 3 秒画面与台词，要具体',
          painPoint: 'string, 中文描述被击中的出行痛点',
          sellingPoint: 'string, 中文描述本条广告主打的卖点',
          factRefs: ['fact id that supports the selling point'],
          productAppearance: 'string, 中文说明产品以什么方式出现（真实界面截图 / 后期叠加 / 口播提及）',
          tone: 'one of the brand tone ids',
          ctaText: 'string, 中文结尾行动引导文案，具体动作',
          beats: [{ role: 'hook|scene|product|proof|cta', name: 'string 中文段落名', description: 'string 中文这段发生什么', approxSec: 3 }],
          durationSec: 15,
          whyItWorks: 'string, 中文说明这条创意为什么可能有效（从完播、共鸣、转化角度）',
          factWarning: 'string or empty, 若因缺少已确认事实而调整了表达，在此说明',
          testHypothesis: 'string, 中文说明这条创意适合验证什么假设',
        },
      ],
    }),
  ]
    .filter(Boolean)
    .join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

export function storyboardMessages({ brandGuide, compliance, picked, assetLib, facts, brief, concept, channel, options = {} }) {
  const duration = concept?.durationSec || brief.durationSec || 15
  const roles = (brandGuide.shotRoles || []).map((r) => `${r.id}: ${r.name} — ${r.desc}`)

  const system = [
    '你是花小猪打车广告的分镜导演，负责把已确认创意拆成可稳定生成的镜头方案。',
    '你对一致性极其严格：同一个人物、同一辆车、同一个场景在每个镜头里必须用完全相同的措辞描述。',
    '你清楚 AI 视频模型画不好中文文字和 App 界面，因此所有优惠金额、界面、Logo、CTA 你都会标为后期叠加。',
    '你会严格控制口播字数，保证在镜头时长内能自然说完。',
    JSON_RULE,
  ].join('\n')

  const shotCountRule = options.shotCount
    ? `Produce exactly ${options.shotCount} shots.`
    : `Decide the shot count based on the structure and information load (typically 4-6 shots for ${duration}s).`

  const durationRule = options.shotDurationSec
    ? `Each shot should be about ${options.shotDurationSec}s.`
    : 'Each shot must be between 2 and 6 seconds, and the total must equal the target duration.'

  const user = [
    brandBlock(brandGuide, channel),
    '',
    complianceBlock(compliance),
    '',
    factBlock(facts),
    '',
    assetBlock(picked, assetLib),
    '',
    briefBlock(brief, brandGuide),
    '',
    conceptBlock(concept),
    '',
    `# SHOT ROLES\n${roles.map((r) => `- ${r}`).join('\n')}`,
    '',
    options.userPreference ? `# OPERATOR NOTES\n${options.userPreference}\n` : '',
    '# TASK',
    `1. Write a GLOBAL STORYBOARD CONTEXT shared by all shots: locked person description (appearance + outfit), locked vehicle, locked scene, time & weather, visual style, lighting, camera style, subtitle/VO style, product UI version.`,
    `2. Break the concept into sequential shot cards. ${shotCountRule} ${durationRule} Total must equal ${duration}s.`,
    `3. Each shot "prompt" is a self-contained ENGLISH video-generation prompt. It MUST repeat the locked person/vehicle/scene wording from the global context verbatim, plus camera angle, movement, action, expression and lighting. It must NOT ask the model to render any text, UI or logo.`,
    `4. Each shot has "vo" (中文口播, may be empty) and "subtitle" (中文字幕, max 14 chars per line). Chinese speech runs about 5 characters per second — vo length must fit the shot duration with breathing room.`,
    `5. Set "renderMode" per shot: "ai" = fully AI generated; "overlay" = AI background plus post-composited text/UI/logo; "asset" = use an existing confirmed asset clip, no AI generation.`,
    `   Any shot showing coupon amounts, prices, thresholds, App UI, logo or CTA MUST be "overlay" or "asset", never plain "ai".`,
    // App 界面一律后期叠加，所以画面里的手机屏必须是关机深色屏；
    // 一旦 prompt 里出现 green screen / chroma key，模型会真渲染出绿幕，后期无法自然合成。
    `   If a shot shows a phone, describe its screen as "a plain dark switched-off display". ` +
      `NEVER write "green screen", "chroma key", "blank green screen", "tracking marker", "placeholder screen" ` +
      `or any coloured placeholder in the prompt — the real app screen is composited in post production.`,
    `6. Set "overlayItems" listing what must be composited in post (e.g. 优惠卡片 / App截图 / Logo / CTA按钮 / 字幕).`,
    `7. Set "factRefs" for any shot whose vo/subtitle makes a product or campaign claim.`,
    `8. Set "transition" describing how this shot connects to the next.`,
    '',
    '# OUTPUT JSON SCHEMA',
    j({
      globalContext: {
        coreIdea: 'string 中文',
        conversionGoal: 'string 中文',
        audienceScene: 'string 中文',
        sellingPoint: 'string 中文，含引用的 fact id',
        person: 'string ENGLISH locked description, reused verbatim in every shot',
        vehicle: 'string ENGLISH locked description or "no vehicle in this ad"',
        scene: 'string ENGLISH locked description',
        timeWeather: 'string ENGLISH',
        visualStyle: 'string ENGLISH',
        lighting: 'string ENGLISH',
        cameraStyle: 'string ENGLISH',
        subtitleStyle: 'string 中文说明字幕与口播风格',
        productUIVersion: 'string 中文说明使用哪个版本的界面素材，若未上传写"待上传"',
      },
      shots: [
        {
          index: 1,
          role: 'hook|scene|product|proof|cta',
          titleCn: 'string 中文镜头标题',
          durationSec: 3,
          personRefs: ['asset id'],
          vehicleRefs: ['asset id'],
          sceneRefs: ['asset id'],
          uiRefs: ['asset id for productUI/brand/overlay assets used in this shot'],
          cameraAngle: 'string from allowed angles',
          cameraMovement: 'string from allowed movements',
          action: 'string ENGLISH what the person does and their expression',
          actionCn: 'string 中文画面说明',
          vo: 'string 中文口播，无口播则空字符串',
          subtitle: 'string 中文字幕，无字幕则空字符串',
          sfx: 'string 中文音效说明',
          prompt: 'string ENGLISH full video prompt, no text rendering',
          negativePrompt: 'string ENGLISH shot specific negatives only',
          renderMode: 'ai|overlay|asset',
          overlayItems: ['string 中文，需后期叠加的内容'],
          factRefs: ['fact id'],
          transition: 'string 中文与下一镜的衔接说明',
        },
      ],
    }),
  ]
    .filter(Boolean)
    .join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

export function shotRegenMessages({ brandGuide, compliance, picked, assetLib, facts, concept, globalContext, shot, neighbors, instruction }) {
  const system = [
    '你是花小猪广告分镜导演，负责修订单个镜头，同时不破坏与其它镜头的连续性。',
    '人物、车辆、场景的锁定措辞必须与全局上下文保持完全一致。',
    JSON_RULE,
  ].join('\n')

  const user = [
    brandBlock(brandGuide, null),
    '',
    complianceBlock(compliance),
    '',
    factBlock(facts),
    '',
    assetBlock(picked, assetLib),
    '',
    conceptBlock(concept),
    '',
    globalContextBlock(globalContext),
    '',
    '# NEIGHBOURING SHOTS (do not change them, keep continuity)',
    j(neighbors),
    '',
    '# CURRENT SHOT TO REVISE',
    j(shot),
    '',
    `# OPERATOR INSTRUCTION\n${instruction || '重新生成这个镜头，让画面表达更清晰有力，保持相同的镜头作用与时长。'}`,
    '',
    '# OUTPUT JSON SCHEMA (single shot object, keep the same id, index and role unless instructed otherwise)',
    j({
      id: shot.id,
      index: shot.index,
      role: shot.role,
      titleCn: 'string',
      durationSec: shot.durationSec,
      personRefs: shot.personRefs || [],
      vehicleRefs: shot.vehicleRefs || [],
      sceneRefs: shot.sceneRefs || [],
      uiRefs: shot.uiRefs || [],
      cameraAngle: 'string',
      cameraMovement: 'string',
      action: 'string ENGLISH',
      actionCn: 'string 中文',
      vo: 'string 中文',
      subtitle: 'string 中文',
      sfx: 'string 中文',
      prompt: 'string ENGLISH',
      negativePrompt: 'string ENGLISH',
      renderMode: 'ai|overlay|asset',
      overlayItems: ['string 中文'],
      factRefs: ['fact id'],
      transition: 'string 中文',
    }),
  ].join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/** 单变量测试：只改指定维度，其余保持不变 */
export function variantMessages({ brandGuide, compliance, picked, assetLib, facts, concept, globalContext, shots, variable, instruction }) {
  const varDef = (brandGuide.testVariableOptions || []).find((v) => v.id === variable)
  const system = [
    '你是花小猪广告的创意测试设计者。你的任务是做严格的单变量替换。',
    '除了指定的变量维度，其它所有内容（人物、车辆、场景、卖点、时长、镜头数）必须逐字保持不变，以保证测试结论可归因。',
    JSON_RULE,
  ].join('\n')

  const user = [
    brandBlock(brandGuide, null),
    '',
    complianceBlock(compliance),
    '',
    factBlock(facts),
    '',
    assetBlock(picked, assetLib),
    '',
    conceptBlock(concept),
    '',
    globalContextBlock(globalContext),
    '',
    '# BASE STORYBOARD (the control version)',
    j(shots.map((s) => ({
      id: s.id,
      index: s.index,
      role: s.role,
      durationSec: s.durationSec,
      action: s.action,
      vo: s.vo,
      subtitle: s.subtitle,
      prompt: s.prompt,
      renderMode: s.renderMode,
    }))),
    '',
    `# TEST VARIABLE\n${variable}: ${varDef?.name || variable} — ${varDef?.desc || ''}`,
    instruction ? `\n# OPERATOR INSTRUCTION\n${instruction}` : '',
    '',
    '# TASK',
    'Produce ONE variant. Only modify the shots that belong to the test variable dimension. For every other shot, return it unchanged (same wording).',
    'Explicitly list which shot indexes changed and which stayed fixed.',
    '',
    '# OUTPUT JSON SCHEMA',
    j({
      variantName: 'string 中文变体名称，体现变化点',
      hypothesis: 'string 中文测试假设，例如"利益前置的钩子比痛点钩子完播更高"',
      changedShotIndexes: [1],
      fixedShotIndexes: [2, 3, 4],
      changeSummary: 'string 中文说明具体改了什么',
      shots: [
        {
          index: 1,
          titleCn: 'string',
          action: 'string ENGLISH',
          actionCn: 'string 中文',
          vo: 'string 中文',
          subtitle: 'string 中文',
          prompt: 'string ENGLISH',
          negativePrompt: 'string ENGLISH',
          overlayItems: ['string'],
          factRefs: ['fact id'],
        },
      ],
    }),
  ]
    .filter(Boolean)
    .join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/* ------------------------- 最终 Prompt 编译 ------------------------- */

/**
 * 把全局上下文 + 分镜卡 + 品牌规范编译成送给视频模型的最终 Prompt。
 * 纯确定性字符串拼装，不依赖 LLM，保证可复现。
 */
export function compileShotRenderPrompt({ brandGuide, picked, globalContext, shot, channel }) {
  const gc = globalContext || {}
  const sa = channel?.safeArea

  const segments = [
    shot.prompt,
    gc.person ? `Person lock: ${gc.person}` : '',
    gc.vehicle && !/no vehicle/i.test(gc.vehicle) ? `Vehicle lock: ${gc.vehicle}` : '',
    gc.scene ? `Scene lock: ${gc.scene}` : '',
    gc.timeWeather,
    shot.cameraAngle ? `Camera: ${shot.cameraAngle}` : '',
    shot.cameraMovement ? `Movement: ${shot.cameraMovement}` : '',
    gc.lighting,
    gc.visualStyle || (brandGuide.visualStyle?.promptFragments || []).join(', '),
    `${brandGuide.format?.aspectRatio || '9:16'} vertical composition, ${brandGuide.format?.resolution || '1080x1920'}`,
    sa
      ? `keep the subject within the central safe area, leave the top ${Math.round(sa.top * 100)}% and bottom ${Math.round(sa.bottom * 100)}% clear for platform UI and captions`
      : '',
    'absolutely no on-screen text, no app interface, no logo, no captions rendered in the image',
    // 手机屏幕要留给后期叠加，但必须是关机深色屏，不能是绿幕
    'if a phone is visible its screen is a plain dark switched-off display, never green screen or chroma key green',
  ]

  const prompt = dedupe(segments.map((s) => String(s || '').trim()).filter(Boolean)).join('. ')

  const negativePrompt = composeNegativePrompt(brandGuide, picked, [shot.negativePrompt || ''])

  const refImages = dedupe(
    [...(shot.personRefs || []), ...(shot.vehicleRefs || []), ...(shot.sceneRefs || [])]
      .map((id) => Object.values(picked).flat().find((a) => a.id === id)?.refImage)
      .filter(Boolean),
  )

  const overlayAssets = (shot.uiRefs || [])
    .map((id) => Object.values(picked).flat().find((a) => a.id === id))
    .filter(Boolean)
    .map((a) => ({ id: a.id, name: a.nameCn || a.name, refImage: a.refImage, ready: Boolean(a.refImage) }))

  return {
    prompt,
    negativePrompt,
    refImages,
    overlayAssets,
    overlayItems: shot.overlayItems || [],
    renderMode: shot.renderMode || 'ai',
    aspectRatio: brandGuide.format?.aspectRatio || '9:16',
    durationSec: shot.durationSec || 3,
    vo: shot.vo || '',
    subtitle: shot.subtitle || '',
    factRefs: shot.factRefs || [],
  }
}
