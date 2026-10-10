export interface AssetItem {
  id: string
  category: string
  name: string
  nameCn?: string
  prompt?: string
  negative?: string
  refImage?: string | null
  tags?: string[]
  note?: string
  custom?: boolean
}

export interface AssetCategory {
  id: string
  name: string
  multi: boolean
  aiGeneratable: boolean
}

export interface AssetLib {
  categories: AssetCategory[]
  items: AssetItem[]
  notice?: string
}

export interface Fact {
  id: string
  type: 'feature' | 'campaign' | 'conversion-path' | 'compliance-note'
  status: 'confirmed' | 'pending' | 'expired'
  title: string
  statement: string
  couponAmount?: string
  threshold?: string
  claimPath?: string
  source?: string
  owner?: string
  validFrom?: string | null
  validTo?: string | null
  cities?: string
  audience?: string
  conditions?: string[]
  usageNote?: string
  custom?: boolean
}

export interface FactLib {
  facts: Fact[]
  factTypes: { id: string; name: string }[]
  statusTypes: { id: string; name: string; usable: boolean }[]
  notice?: string
}

export interface Channel {
  id: string
  name: string
  platform: string
  aspectRatio: string
  resolution: string
  durationRange: [number, number]
  recommendedDuration: [number, number]
  safeArea: { top: number; bottom: number; left: number; right: number; note: string }
  firstFrameRule: string
  audioRule: string
  notes: string[]
}

export interface ComplianceRule {
  id: string
  name: string
  severity: 'block' | 'warn'
  basis: string
  terms: string[]
}

export interface Compliance {
  rules: ComplianceRule[]
  requireFactBinding: { note: string; patterns: string[] }
  overlayRequired: { note: string; categories: string[] }
  notice?: string
}

export interface BrandGuide {
  id: string
  name: string
  notice?: string
  format: { aspectRatio: string; resolution: string; fps: number; durationRange: [number, number]; defaultDuration: number }
  brandIdentity: {
    productName: string
    productNameEn: string
    category: string
    positioning: string
    primaryColor: string
    primaryColorNote?: string
    secondaryColor: string
    fontFamily: string
    fontNote?: string
    logoRules: string[]
  }
  visualStyle: { label: string; promptFragments: string[]; description: string }
  cameraStyle: { label: string; defaultAngles: string[]; defaultMovements: string[] }
  lighting: { presets: { id: string; name: string; prompt: string }[]; default: string }
  toneOptions: { id: string; name: string; prompt: string }[]
  audienceOptions: { id: string; name: string; painPoints: string[] }[]
  sceneOptions: { id: string; name: string; prompt: string }[]
  ctaOptions: { id: string; name: string; text: string; action: string }[]
  productDisplayRules: string[]
  copyRules: string[]
  restrictions: string[]
  negativePromptLibrary: Record<string, string[]>
  shotRoles: { id: string; name: string; desc: string }[]
  adStructures: { id: string; name: string; beats: { role: string; name: string; range: string }[] }[]
  testVariableOptions: { id: string; name: string; desc: string }[]
}

export interface Brief {
  channel: string
  audience: string
  scene: string
  campaign: string
  sellingPoint: string
  goal: string
  tone: string
  cta: string
  durationSec: number
  reference: string
  constraints: string
  notes: string
}

export interface Beat {
  role: string
  name: string
  description: string
  approxSec?: number
}

export interface ComplianceHit {
  ruleId: string
  ruleName: string
  severity: 'block' | 'warn'
  basis: string
  term: string
  where: string
  excerpt?: string
}

export interface Concept {
  id: string
  title: string
  coreIdea: string
  structureId?: string
  audienceFit: string
  hook: string
  painPoint: string
  sellingPoint: string
  factRefs: string[]
  productAppearance: string
  tone: string
  ctaText: string
  beats: Beat[]
  durationSec: number
  whyItWorks?: string
  factWarning?: string
  testHypothesis?: string
  complianceHits?: ComplianceHit[]
  source?: string
}

export interface GlobalContext {
  coreIdea?: string
  conversionGoal?: string
  audienceScene?: string
  sellingPoint?: string
  person?: string
  vehicle?: string
  scene?: string
  timeWeather?: string
  visualStyle?: string
  lighting?: string
  cameraStyle?: string
  subtitleStyle?: string
  productUIVersion?: string
}

export type RenderMode = 'ai' | 'overlay' | 'asset'

export interface Shot {
  id: string
  index: number
  role: string
  titleCn: string
  durationSec: number
  personRefs: string[]
  vehicleRefs: string[]
  sceneRefs: string[]
  uiRefs: string[]
  cameraAngle: string
  cameraMovement: string
  action: string
  actionCn?: string
  vo: string
  subtitle: string
  sfx?: string
  prompt: string
  negativePrompt: string
  renderMode: RenderMode
  overlayItems: string[]
  factRefs: string[]
  transition?: string
  preview?: { url: string; source: string } | null
  approved?: boolean
}

export interface Storyboard {
  globalContext: GlobalContext
  shots: Shot[]
  conceptId?: string
  source?: string
  generatedAt?: string
}

export interface ShotRender {
  status: 'succeeded' | 'running' | 'failed' | 'manual' | 'simulated'
  url?: string
  rawUrl?: string
  taskId?: string
  message?: string
  error?: string | null
  attempts?: number
  approved?: boolean
  reviewNote?: string
  updatedAt?: string
  backend?: string
  veoModel?: string
  actualDurationSec?: number
  usedFirstFrame?: boolean
  overlayApplied?: boolean
  overlayInfo?: {
    images: number
    imageNames?: string[]
    subtitle: boolean
    subtitleText?: string
    watermark?: boolean
    vo?: { url: string; voiceName: string; rate: number; chars: number; estimatedSec: number; overflow: boolean } | null
    voError?: string | null
    font?: string | null
    note?: string
  }
  compiled?: {
    prompt: string
    negativePrompt: string
    refImages: string[]
    overlayAssets: { id: string; name: string; refImage?: string | null; ready: boolean }[]
    overlayItems: string[]
    renderMode: RenderMode
    aspectRatio: string
    durationSec: number
    vo: string
    subtitle: string
    factRefs: string[]
  }
}

export interface Variant {
  id: string
  variable: string
  variantName: string
  hypothesis: string
  changeSummary: string
  changedShotIndexes: number[]
  fixedShotIndexes: number[]
  shots: Shot[]
  source?: string
  createdAt: string
}

export interface Project {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  phase: number
  assets: Record<string, string[]>
  facts: string[]
  brief: Brief
  concepts: Concept[]
  selectedConceptId: string | null
  storyboard: Storyboard | null
  review: { approved: boolean; approvedAt: string | null; checklist: Record<string, boolean>; notes: string }
  render: {
    model: string
    params: Record<string, unknown>
    shots: Record<string, ShotRender>
    voicePreset?: string
    finalVideo: {
      url: string
      shotCount: number
      durationSec: number
      overlayCount?: number
      subtitleCount?: number
      voCount?: number
      assetCount?: number
      assembledAt: string
    } | null
    cover: string | null
  }
  variants: Variant[]
  _impact?: ImpactResult | null
}

export interface ProjectSummary {
  id: string
  name: string
  phase: number
  updatedAt: string
  channel?: string
  audience?: string
  scene?: string
  durationSec?: number
  shotCount: number
  variantCount: number
  approved: boolean
  finalVideo: string | null
  cover?: string | null
}

export interface IssueFix {
  action: string
  label: string
  auto: boolean
  payload?: Record<string, any>
  alt?: { action: string; label: string; auto: boolean }
  preferManual?: boolean
}

export interface Issue {
  type?: string
  severity: 'block' | 'warn'
  reason: string
  term?: string
  chars?: number
  budget?: number
  fix?: IssueFix
}

export interface ValidateSummary {
  blockers: number
  warnings: number
  autoFixable?: number
  manualOnly?: number
  needsUpload?: number
  totalDuration: number
}

export interface ValidateResult {
  shots: { shotId: string; index: number; role: string; issues: Issue[] }[]
  global: Issue[]
  summary: ValidateSummary
  missingAssets: { id: string; name: string; note?: string }[]
  channel: { id: string; name: string } | null
}

export interface FixReportEntry {
  scope: string
  action?: string
  detail?: string
  reason?: string
  label?: string
  assetIds?: string[]
  before?: { vo?: string; subtitle?: string }
  after?: { vo?: string; subtitle?: string }
}

export interface AutoFixResult {
  project: Project
  report: {
    applied: FixReportEntry[]
    skipped: FixReportEntry[]
    needsManual: FixReportEntry[]
    rewriteSource?: string | null
  }
  before: ValidateSummary
  after: ValidateSummary
  validation: ValidateResult
}

export interface ImpactResult {
  shots: { id: string; index: number; role: string; titleCn: string; reason: string; hasRender: boolean }[]
  variants: { id: string; name: string }[]
  note: string
}

export interface Meta {
  phases: { id: number; key: string; name: string }[]
  brandGuide: BrandGuide
  assets: AssetLib
  facts: FactLib
  channels: Channel[]
  compliance: Compliance
  providers: { llm: string; image: string; video: string; tts: string }
  ffmpeg: boolean
  subtitleFont: string | null
  videoMode: string
  ttsEnabled: boolean
  voices: { id: string; name: string; desc: string }[]
  vertex?: { enabled: boolean; project?: string; location?: string; veoModel?: string }
}
