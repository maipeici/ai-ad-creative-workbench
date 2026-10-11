export interface ReferenceMetrics {
  views: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null
  ctr: number | null; cvr: number | null; cpa: number | null
}
export interface InspirationReference {
  id: string; title: string; platform: string; industry: string; sourceUrl: string; creator: string
  sourceNote: string; script: string; tags: string; contentType: 'organic' | 'ad'; publishedAt: string; observedAt: string
  metrics: ReferenceMetrics; isDemo: boolean; createdAt: string; updatedAt: string; archived: boolean
  reasons?: string[]; engagement?: number | null; cohortSize?: number
}
export interface InspirationAnalysis {
  referenceId: string; summary: string; source: string; fingerprint: string; analyzedAt: string; limitations: string
  segments: {timing: string; role: string; evidence: string; explanation: string}[]
  suggestions: {id: string; label: string; pattern: string; adaptation: string; caution: string; testHypothesis: string}[]
}
export interface InspirationAttribution {
  referenceId: string; title: string; platform: string; industry: string; sourceUrl: string; isDemo: boolean
  suggestionIds: string[]; analyzedAt: string; summary: string
}
export interface InspirationLibrary {
  items: InspirationReference[]; platforms: {id: string; name: string}[]; industries: {id: string; name: string}[]
  importedCount: number; mode: 'demo' | 'imported'; defaults: {platform: string; industry: string}
}
