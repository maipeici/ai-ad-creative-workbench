import type { Meta, Project, Shot } from '../types'

// Kept in memory only. The tour never creates or edits a saved project.
export function createDemoProject(meta: Meta): Project {
  const facts = meta.facts.facts.filter(f => f.type === 'feature' && f.status === 'confirmed').slice(0, 2).map(f => f.id)
  const shots: Shot[] = [
    ['hook', '下班了，想早点回家', 3, '下班了，只想早点回家。', '下班只想早点回家'],
    ['pain', '忙碌一天后的出行需求', 4, '忙了一天，回家少点折腾。', '回家少点折腾'],
    ['product', '查看预估价，一键叫车', 5, '打开花小猪，先看预估价再叫车。', '先看预估价再叫车'],
    ['cta', '轻松开启下一段行程', 3, '打开花小猪，试试看。', '打开花小猪']
  ].map(([role, titleCn, durationSec, vo, subtitle], i) => ({
    id: `demo-shot-${i + 1}`, index: i + 1, role: String(role), titleCn: String(titleCn),
    durationSec: Number(durationSec), vo: String(vo), subtitle: String(subtitle),
    personRefs: [], vehicleRefs: [], sceneRefs: [], uiRefs: [],
    cameraAngle: 'eye-level medium shot', cameraMovement: 'handheld follow',
    action: 'An office worker finishes work and prepares to travel home.',
    actionCn: '跟随下班的人物，从写字楼门口走向上车点。',
    prompt: 'Natural documentary footage of an office worker heading home, consistent character and evening light.',
    negativePrompt: 'distorted faces, generated text, fake brand logos',
    renderMode: 'overlay', overlayItems: ['字幕', ...(i === 3 ? ['官方 Logo 与行动引导'] : [])], factRefs: facts,
  }))
  return {
    id: 'guide-preview-only', name: '演示项目 · 下班返程广告', phase: 1,
    createdAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T00:00:00Z',
    assets: Object.fromEntries(meta.assets.categories.map(c => [c.id, meta.assets.items.filter(a => a.category === c.id).slice(0, 1).map(a => a.id)])),
    facts,
    brief: {
      channel: meta.channels[0]?.id || '', audience: meta.brandGuide.audienceOptions[0]?.id || '',
      scene: meta.brandGuide.sceneOptions.find(s => s.id === 'commute-evening')?.id || meta.brandGuide.sceneOptions[0]?.id || '',
      campaign: '本次聚焦产品功能，不使用未经确认的优惠金额', sellingPoint: '一键叫车、行前预估价',
      goal: '引导了解产品与下载', tone: meta.brandGuide.toneOptions[0]?.id || '',
      cta: meta.brandGuide.ctaOptions.find(c => c.id === 'open-app')?.id || meta.brandGuide.ctaOptions[0]?.id || '',
      durationSec: 15, reference: '日常下班场景，真实生活感', constraints: 'Logo 与产品界面使用官方素材；避免生成虚构优惠。', notes: '仅供操作导览的固定示例。',
    },
    concepts: [{
      id: 'demo-concept', title: '下班回家，少一点折腾', coreIdea: '用下班后的疲惫建立共鸣，再展示查看预估价与叫车的路径。',
      audienceFit: '通勤者想降低出行决策成本，让回家这件事更轻松。', hook: '结束一天工作后，你最想做的事是什么？',
      painPoint: '下班后疲惫，仍要花时间决定怎么回家。', sellingPoint: '一键叫车、行前预估价', factRefs: facts,
      productAppearance: '真实产品录屏在后期叠加，避免模型编造 App 界面。', tone: 'relatable', ctaText: '打开花小猪，试试看。',
      beats: shots.map(s => ({ role: s.role, name: s.titleCn, description: s.vo, approxSec: s.durationSec })),
      durationSec: 15, whyItWorks: '把产品能力放进具体生活场景，帮助受众理解使用价值。',
      testHypothesis: '比较不同开场钩子对前三秒留存的影响。', source: 'guide-example',
    }],
    selectedConceptId: 'demo-concept',
    storyboard: { conceptId: 'demo-concept', source: '固定演示示例', shots, globalContext: {
      coreIdea: '下班回家，少一点折腾', conversionGoal: '引导了解产品与下载', audienceScene: '下班返程的城市通勤者',
      sellingPoint: '一键叫车、行前预估价', person: 'An ordinary office worker, consistent face and casual clothing.',
      vehicle: 'An ordinary clean white compact sedan, no generated branding.', scene: 'Outside an office building at evening.',
      timeWeather: 'clear evening', visualStyle: meta.visualDesign.visualStyle.promptFragments.join(', '),
      lighting: 'soft evening light', cameraStyle: meta.visualDesign.cameraStyle.label, subtitleStyle: '简短口语，字幕清晰',
      productUIVersion: '真实产品录屏，后期叠加',
    } },
    review: { mode: 'automatic', status: 'idle', approved: false, approvedAt: null, checklist: {}, notes: '', requirements: [...meta.reviewChecklist] },
    render: { model: '', params: {}, shots: {}, finalVideo: { url: '/demo/sample-ad.mp4', shotCount: 4, durationSec: 15, assembledAt: '2026-09-22T09:15:04Z' }, cover: '/demo/sample-ad-cover.jpg' },
    variants: [],
  }
}
