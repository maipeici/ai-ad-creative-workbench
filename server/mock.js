/**
 * Mock 生成器（花小猪广告版）
 * ---------------------------------------------------------------
 * 未配置 LLM 时使用。基于「品牌规范 + 已选素材 + 已确认事实 + Content Brief」
 * 的确定性模板推导，结构与真实 LLM 输出一致，可用于流程验证与培训。
 * 严格遵守：不编造任何金额、门槛或承诺；无已确认活动事实时只讲产品通用功能。
 */

function nameOf(items, fallback = '') {
  return items?.length ? items[0].nameCn || items[0].name : fallback
}

function promptOf(items) {
  return (items || []).map((i) => i.prompt).filter(Boolean).join(', ')
}

/** 只使用已确认的事实，绝不编造 */
function pickFacts(facts) {
  const feature = facts.confirmed.filter((f) => f.type === 'feature')
  const campaign = facts.confirmed.filter((f) => f.type === 'campaign')
  const path = facts.confirmed.filter((f) => f.type === 'conversion-path')
  return { feature, campaign, path }
}

export function mockConcepts({ brandGuide, brief, picked, facts, count = 3, avoid = [], userPreference = '' }) {
  const aud = (brandGuide.audienceOptions || []).find((a) => a.id === brief.audience)
  const scn = (brandGuide.sceneOptions || []).find((s) => s.id === brief.scene)
  const cta = (brandGuide.ctaOptions || []).find((c) => c.id === brief.cta)
  const tone = brief.tone || 'relatable'
  const duration = brief.durationSec || 15

  const audName = aud?.name || '目标用户'
  const pain = aud?.painPoints?.[0] || '出行不方便'
  const scnName = scn?.name || '日常出行'
  const ctaText = cta?.text || '打开花小猪打车看看'

  const { feature, campaign } = pickFacts(facts)
  const hasCampaign = campaign.length > 0
  const mainFact = campaign[0] || feature[0] || null
  const sellingPoint = brief.sellingPoint || mainFact?.title || '一键叫车，出行更方便'
  const factRefs = mainFact ? [mainFact.id] : []
  const factWarning = hasCampaign
    ? ''
    : '本项目没有已确认的活动事实，创意只表达产品通用功能，未涉及任何优惠金额。如需表达权益，请先在 Phase 1 补充并确认活动资料。'

  const person = nameOf(picked.person, '普通上班族')
  const vehicleName = nameOf(picked.vehicle, '普通轿车')

  const blueprints = [
    {
      title: `${scnName}的那一刻，${audName}都懂`,
      structureId: 'problem-solution-cta',
      coreIdea: `以 ${scnName} 中一个真实的小困境开场，${person} 用花小猪打车解决问题，结尾引导${cta?.name || '打开App'}。`,
      audienceFit: `${audName}最典型的痛点是「${pain}」，${scnName}正是这个痛点被触发的时刻，代入感强。`,
      hook: `前 3 秒直接给出困境画面：${person}在${scnName}里停下来，露出为难的表情，字幕点出痛点。`,
      painPoint: pain,
      productAppearance: '产品以真实 App 截图后期叠加的方式出现，不由模型绘制界面',
      ctaText,
      beats: [
        { role: 'hook', name: '痛点亮相', description: `${scnName}中遇到困境的瞬间`, approxSec: 3 },
        { role: 'scene', name: '场景共鸣', description: `${person}的真实反应，让用户确认这是自己`, approxSec: 4 },
        { role: 'product', name: '产品价值', description: `拿出手机使用花小猪打车，展示真实界面`, approxSec: 5 },
        { role: 'cta', name: '行动引导', description: `上车后的轻松状态 + 品牌与行动引导`, approxSec: 3 },
      ],
      whyItWorks: '痛点—解决—引导是效果广告最稳的结构，前 3 秒具体画面有利于完播，结尾动作明确有利于转化。',
      testHypothesis: '验证「具体场景痛点开场」是否比「直接讲优惠」有更高的完播率。',
    },
    {
      title: `${audName}的出行小技巧`,
      structureId: 'testimonial',
      coreIdea: `${person}以第一人称口播分享自己在${scnName}时的出行方式，真实口碑感。`,
      audienceFit: `第一人称口碑对${audName}更可信，弱化广告感，适合视频号与快手生态。`,
      hook: `前 3 秒用一句结论式口播抓人：直接说出自己在${scnName}怎么解决问题。`,
      painPoint: pain,
      productAppearance: '口播中自然提及产品名，配合真实界面截图叠加',
      ctaText,
      beats: [
        { role: 'hook', name: '一句结论', description: `${person}对镜头说出自己的做法`, approxSec: 3 },
        { role: 'scene', name: '我的处境', description: `还原${scnName}的真实处境`, approxSec: 4 },
        { role: 'product', name: '我怎么解决', description: '展示操作过程与真实界面', approxSec: 5 },
        { role: 'cta', name: '推荐动作', description: '推荐观众也这样做', approxSec: 3 },
      ],
      whyItWorks: '口碑型素材广告感弱、信任度高，适合作为对照组验证真人出镜的价值。',
      testHypothesis: '验证真人第一人称口播是否比情景演绎带来更高的点击率。',
    },
    {
      title: `以前这样，现在这样`,
      structureId: 'contrast',
      coreIdea: `用前后对比呈现${scnName}的体验差异，${person}从为难变为轻松。`,
      audienceFit: `对比结构能快速让${audName}感知价值变化，信息传达效率高。`,
      hook: `前 4 秒呈现「以前有多难」，画面拥挤或等待，情绪偏低。`,
      painPoint: pain,
      productAppearance: '转折后展示 App 真实界面与上车画面',
      ctaText,
      beats: [
        { role: 'hook', name: '以前有多难', description: `${scnName}中等待或拥挤的画面`, approxSec: 4 },
        { role: 'scene', name: '转折', description: '拿出手机的动作作为转折点', approxSec: 3 },
        { role: 'product', name: '现在怎么样', description: `${vehicleName}到达，顺利上车`, approxSec: 5 },
        { role: 'cta', name: '行动引导', description: '品牌与明确行动引导', approxSec: 3 },
      ],
      whyItWorks: '对比反差视觉冲击强，适合静音环境下靠画面传达价值。',
      testHypothesis: '验证对比结构是否比单线叙事更能提升转化率。',
    },
    {
      title: `${scnName}，一键就走`,
      structureId: 'benefit-first',
      coreIdea: `把产品能力前置到开头，再用${scnName}场景验证，结构紧凑适合短时长。`,
      audienceFit: `${audName}对效率敏感，利益与能力前置可减少流失。`,
      hook: `前 3 秒直接给出核心能力：${sellingPoint}。`,
      painPoint: pain,
      productAppearance: '开头即出现真实界面叠加，强化产品认知',
      ctaText,
      beats: [
        { role: 'hook', name: '能力前置', description: `直接点出${sellingPoint}`, approxSec: 3 },
        { role: 'product', name: '怎么用', description: '展示真实操作路径', approxSec: 5 },
        { role: 'proof', name: '真实结果', description: `${scnName}中顺利上车的结果画面`, approxSec: 4 },
        { role: 'cta', name: '行动引导', description: '品牌与行动引导', approxSec: 3 },
      ],
      whyItWorks: '利益前置在信息流中通常有更好的前 3 秒留存，适合与痛点开场做 A/B 对比。',
      testHypothesis: '验证利益前置与痛点开场哪种钩子更适合该人群。',
    },
  ]

  const avoidSet = new Set(avoid.map((a) => String(a).toLowerCase()))
  const pool = blueprints.filter((b) => !avoidSet.has(b.title.toLowerCase()))
  const source = pool.length >= count ? pool : blueprints

  const concepts = []
  for (let i = 0; i < count; i++) {
    const b = source[(i + avoid.length) % source.length]
    concepts.push({
      ...b,
      sellingPoint,
      factRefs,
      factWarning,
      tone,
      durationSec: duration,
      whyItWorks: userPreference ? `${b.whyItWorks}（已结合运营偏好：${userPreference}）` : b.whyItWorks,
    })
  }
  return { concepts }
}

export function mockStoryboard({ brandGuide, brief, picked, facts, concept, options = {} }) {
  const duration = concept?.durationSec || brief.durationSec || 15
  const aud = (brandGuide.audienceOptions || []).find((a) => a.id === brief.audience)
  const scn = (brandGuide.sceneOptions || []).find((s) => s.id === brief.scene)
  const lightPreset =
    (brandGuide.lighting?.presets || []).find((p) => p.id === (brandGuide.lighting?.default || 'evening-rush')) ||
    brandGuide.lighting?.presets?.[0]

  const personAsset = picked.person?.[0]
  const outfitAsset = picked.outfit?.[0]
  const vehicleAsset = picked.vehicle?.[0]
  const interiorAsset = picked.vehicle?.find((v) => v.id.includes('interior'))
  const sceneAsset = picked.scene?.[0]
  const propAsset = picked.prop?.[0]
  const uiOrder = picked.productUI?.find((u) => u.id.includes('home') || u.id.includes('order')) || picked.productUI?.[0]
  const logoAsset = picked.brand?.[0]

  const personLock = [personAsset?.prompt, outfitAsset?.prompt].filter(Boolean).join(', ') ||
    'an ordinary Chinese adult, everyday casual clothing, relatable appearance'
  const vehicleLock = vehicleAsset?.prompt || 'no vehicle in this ad'
  const sceneLock = sceneAsset?.prompt || scn?.prompt || 'an ordinary Chinese city street'

  const { campaign, feature } = pickFacts(facts)
  const mainFact = campaign[0] || feature[0] || null
  const factRefs = mainFact ? [mainFact.id] : []

  const globalContext = {
    coreIdea: concept?.coreIdea || '花小猪打车出行场景广告',
    conversionGoal: brief.goal || '引导下载与首单',
    audienceScene: `${aud?.name || '目标用户'} / ${scn?.name || '日常出行'}`,
    sellingPoint: mainFact ? `${mainFact.title}（依据 ${mainFact.id}）` : '产品通用功能，无活动权益表达',
    person: personLock,
    vehicle: vehicleLock,
    scene: sceneLock,
    timeWeather: lightPreset?.name || '傍晚',
    visualStyle: (brandGuide.visualStyle?.promptFragments || []).join(', '),
    lighting: lightPreset?.prompt || 'natural daylight',
    cameraStyle: brandGuide.cameraStyle?.label || '生活化手持视角',
    subtitleStyle: '口语化短句，单行不超过 14 字，字幕置于底部安全区之上',
    productUIVersion: uiOrder?.refImage ? `已上传：${uiOrder.nameCn || uiOrder.name}` : '待上传官方界面素材',
  }

  const beats = concept?.beats?.length
    ? concept.beats
    : [
        { role: 'hook', name: '痛点亮相', description: '呈现出行困境' },
        { role: 'scene', name: '场景共鸣', description: '人物真实反应' },
        { role: 'product', name: '产品价值', description: '使用花小猪打车' },
        { role: 'cta', name: '行动引导', description: '品牌与行动引导' },
      ]

  const shotCount = options.shotCount || beats.length
  const angles = brandGuide.cameraStyle?.defaultAngles || ['eye-level medium shot']
  const moves = brandGuide.cameraStyle?.defaultMovements || ['handheld follow']

  const shots = []
  let remaining = duration
  for (let i = 0; i < shotCount; i++) {
    const beat = beats[Math.min(i, beats.length - 1)]
    const last = i === shotCount - 1
    const base = options.shotDurationSec || duration / shotCount
    const dur = last ? Math.max(2, Math.round(remaining * 10) / 10) : Math.max(2, Math.round(base * 10) / 10)
    remaining = Math.round((remaining - dur) * 10) / 10

    const role = beat.role || (i === 0 ? 'hook' : last ? 'cta' : 'scene')
    const isProduct = role === 'product' || role === 'proof'
    const isCta = role === 'cta'

    let action
    let vo
    let subtitle
    let overlayItems = []
    let uiRefs = []
    let renderMode = 'ai'

    if (role === 'hook') {
      action = `the person stops on the sidewalk and looks around with a slightly troubled expression${propAsset ? `, holding ${propAsset.prompt}` : ''}`
      vo = `${scn?.name || '出门'}的时候最怕这种情况。`
      subtitle = `${scn?.name || '出行'}遇到这种情况`
      overlayItems = ['字幕']
      renderMode = 'overlay'
    } else if (role === 'scene') {
      action = 'the person sighs, checks the time, and takes out a phone from the pocket'
      vo = '以前只能干等着。'
      subtitle = '以前只能干等着'
      overlayItems = ['字幕']
      renderMode = 'overlay'
    } else if (isProduct) {
      action = 'close up of the person holding the phone, screen facing camera but screen content left blank for post compositing, then looking up relieved'
      vo = mainFact ? `我现在都用花小猪打车，${mainFact.title}。` : '我现在都用花小猪打车，一键就能叫。'
      subtitle = mainFact ? mainFact.title : '一键叫车很方便'
      overlayItems = ['App 真实界面截图', '字幕']
      uiRefs = [uiOrder?.id].filter(Boolean)
      renderMode = 'overlay'
    } else if (isCta) {
      action = `the person gets into the car at the curb and settles in comfortably with the seatbelt on, calm relieved expression`
      vo = concept?.ctaText || '打开花小猪打车看看。'
      subtitle = concept?.ctaText || '打开花小猪打车'
      overlayItems = ['品牌 Logo', 'CTA 按钮', '字幕']
      uiRefs = [logoAsset?.id].filter(Boolean)
      renderMode = 'overlay'
    } else {
      action = 'the person walks toward the waiting car with a relaxed expression'
      vo = ''
      subtitle = ''
      renderMode = 'ai'
    }

    const sceneForShot = isCta && vehicleAsset ? `${sceneLock}, ${vehicleAsset.prompt}` : sceneLock

    shots.push({
      id: `shot-${i + 1}`,
      index: i + 1,
      role,
      titleCn: `${beat.name}｜${beat.description || ''}`,
      durationSec: dur,
      personRefs: personAsset ? [personAsset.id] : [],
      vehicleRefs: isCta && vehicleAsset ? [vehicleAsset.id, interiorAsset?.id].filter(Boolean) : [],
      sceneRefs: sceneAsset ? [sceneAsset.id] : [],
      uiRefs,
      cameraAngle: angles[i % angles.length],
      cameraMovement: moves[i % moves.length],
      action,
      actionCn: beat.description || '',
      vo,
      subtitle,
      sfx: role === 'hook' ? '环境街道声' : isCta ? '轻快结尾音' : '环境声',
      prompt: [
        personLock,
        action,
        sceneForShot,
        angles[i % angles.length],
        moves[i % moves.length],
        globalContext.lighting,
        globalContext.visualStyle,
        `${brandGuide.format?.aspectRatio || '9:16'} vertical composition`,
      ]
        .filter(Boolean)
        .join(', '),
      negativePrompt: isCta ? 'no seatbelt, dangerous boarding' : '',
      renderMode,
      overlayItems,
      factRefs: isProduct || isCta ? factRefs : [],
      transition: last ? '结束定格在品牌与 CTA' : '硬切到下一镜',
      preview: null,
      approved: false,
    })
  }

  return { globalContext, shots }
}

export function mockShotRevision({ shot, instruction }) {
  const suffix = instruction ? `, ${instruction}` : ', clearer composition and stronger subject readability'
  return {
    ...shot,
    titleCn: `${shot.titleCn}（已修订）`,
    prompt: `${shot.prompt}${suffix}`,
    actionCn: instruction || shot.actionCn,
  }
}

export function mockVariant({ shots, variable, brandGuide }) {
  const varDef = (brandGuide.testVariableOptions || []).find((v) => v.id === variable)
  const roleMap = { hook: 'hook', 'selling-point': 'product', cta: 'cta', scene: 'scene', audience: null, tone: null }
  const targetRole = roleMap[variable]

  const changed = []
  const fixed = []
  const out = shots.map((s) => {
    const shouldChange = targetRole ? s.role === targetRole : true
    if (!shouldChange) {
      fixed.push(s.index)
      return { index: s.index, titleCn: s.titleCn, action: s.action, actionCn: s.actionCn, vo: s.vo, subtitle: s.subtitle, prompt: s.prompt, negativePrompt: s.negativePrompt, overlayItems: s.overlayItems, factRefs: s.factRefs }
    }
    changed.push(s.index)
    return {
      index: s.index,
      titleCn: `${s.titleCn}（变体 B）`,
      action: `${s.action}, alternative performance take`,
      actionCn: `${s.actionCn}（替换版本）`,
      vo: s.vo ? `${s.vo}` : '',
      subtitle: s.subtitle,
      prompt: `${s.prompt}, alternative framing variation`,
      negativePrompt: s.negativePrompt,
      overlayItems: s.overlayItems,
      factRefs: s.factRefs,
    }
  })

  return {
    variantName: `变体B · 替换${varDef?.name || variable}`,
    hypothesis: `验证替换${varDef?.name || variable}后对完播与点击的影响`,
    changedShotIndexes: changed,
    fixedShotIndexes: fixed,
    changeSummary: `仅替换${varDef?.name || variable}相关镜头（#${changed.join(', #')}），其余镜头完全复用`,
    shots: out,
  }
}
