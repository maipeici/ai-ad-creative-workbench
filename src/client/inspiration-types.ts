export interface ReferenceMetrics {
  views: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null
  ctr: number | null; cvr: number | null; cpa: number | null
}
export interface InspirationReference {
  video?: ReferenceVideo
  id: string; title: string; platform: string; industry: string; sourceUrl: string; creator: string
  sourceNote: string; script: string; tags: string; contentType: 'organic' | 'ad'; publishedAt: string; observedAt: string
  metrics: ReferenceMetrics; isDemo: boolean; createdAt: string; updatedAt: string; archived: boolean
  reasons?: string[]; engagement?: number | null; cohortSize?: number
}
export interface InspirationAnalysis {
  inputKind?: 'script'|'video'; transcript?: string; highlights?: ReferenceHighlight[]
  referenceId: string; summary: string; source: string; fingerprint: string; analyzedAt: string; limitations: string
  segments: ReferenceSegment[]
  suggestions: {id: string; label: string; pattern: string; adaptation: string; caution: string; testHypothesis: string}[]
}
export interface InspirationAttribution {
  version?: number; video?: ReferenceVideo; inputKind?: 'script'|'video'; guidance?: InspirationAnalysis['suggestions']; segments?: ReferenceSegment[]; highlights?: ReferenceHighlight[]
  adaptedFromConceptId?: string; adaptedFromTitle?: string
  referenceId: string; title: string; platform: string; industry: string; sourceUrl: string; isDemo: boolean
  suggestionIds: string[]; analyzedAt: string; summary: string
}
export interface InspirationLibrary {
  videoAnalysisAvailable?: boolean
  items: InspirationReference[]; platforms: {id: string; name: string}[]; industries: {id: string; name: string}[]
  importedCount: number; mode: 'demo' | 'imported'; defaults: {platform: string; industry: string}
}
export interface ReferenceVideo {url:string;name:string;mimeType:string;size:number;sha256:string;uploadedAt:string}
export interface ReferenceHighlight {point:string;evidence:string;mechanism:string}
export interface ReferenceSegment {timing:string;role:string;evidence:string;explanation:string;startSec?:number;endSec?:number;visual?:string;audio?:string}
export interface ShotReferenceUse {suggestionIds:string[];sourceTiming:string;adaptation:string;visualPrompt:string}
