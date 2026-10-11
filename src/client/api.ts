import type { InspirationReference, InspirationLibrary, InspirationAnalysis } from './inspiration-types'
import type {
  AssetItem,
  AutoFixResult,
  Fact,
  ImpactResult,
  Meta,
  Project,
  ProjectSummary,
  ValidateResult,
} from './types'

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: init?.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...init,
  })
  const text = await res.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { error: text }
  }
  if (!res.ok) throw Object.assign(new Error(data?.error || `请求失败 ${res.status}`), { payload: data })
  return data as T
}

const body = (v: unknown) => JSON.stringify(v ?? {})

export const api = {
  inspirations: (query: Record<string,string>) => req<InspirationLibrary>('/api/inspirations?' + new URLSearchParams(query)),
  createInspiration: (data: Record<string,unknown>) => req<InspirationReference>('/api/inspirations', {method:'POST',body:body(data)}),
  updateInspiration: (id:string, data:Record<string,unknown>) => req<InspirationReference>('/api/inspirations/'+id, {method:'PATCH',body:body(data)}),
  importInspirations: (content:string,format:string) => req<{count:number;items:InspirationReference[]}>('/api/inspirations/import',{method:'POST',body:body({content,format})}),
  analyzeInspiration: (id:string,referenceId:string) => req<{project:Project;analysis:InspirationAnalysis}>(`/api/projects/${id}/inspirations/${referenceId}/analyze`,{method:'POST'}),
  applyInspiration: (id:string,referenceId:string,suggestionIds:string[]) => req<{project:Project}>(`/api/projects/${id}/inspirations/${referenceId}/apply`,{method:'POST',body:body({suggestionIds})}),
  meta: () => req<Meta>('/api/meta'),

  listProjects: () => req<ProjectSummary[]>('/api/projects'),
  createProject: (name: string) => req<Project>('/api/projects', { method: 'POST', body: body({ name }) }),
  getProject: (id: string) => req<Project>(`/api/projects/${id}`),
  patchProject: (id: string, patch: Record<string, unknown>) =>
    req<Project>(`/api/projects/${id}`, { method: 'PATCH', body: body(patch) }),
  deleteProject: (id: string) => req<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),

  createAsset: (item: Partial<AssetItem>) => req<AssetItem>('/api/assets', { method: 'POST', body: body(item) }),
  updateAsset: (id: string, patch: Partial<AssetItem>) =>
    req<AssetItem>(`/api/assets/${id}`, { method: 'PATCH', body: body(patch) }),
  deleteAsset: (id: string) => req<{ ok: boolean }>(`/api/assets/${id}`, { method: 'DELETE' }),

  buildCouponCard: (factId: string, headline?: string) =>
    req<{ card: { png: string; bytes: number; factId: string; source?: string }; asset: AssetItem }>('/api/cards/coupon', {
      method: 'POST',
      body: body({ factId, headline }),
    }),

  buildCtaCard: (text: string) =>
    req<{ card: { png: string; bytes: number }; asset: AssetItem; warnings: any[] }>('/api/cards/cta', {
      method: 'POST',
      body: body({ text }),
    }),

  createFact: (f: Partial<Fact>) => req<Fact>('/api/facts', { method: 'POST', body: body(f) }),
  updateFact: (id: string, patch: Partial<Fact>) =>
    req<{ fact: Fact; impacted: any[] }>(`/api/facts/${id}`, { method: 'PATCH', body: body(patch) }),
  deleteFact: (id: string) => req<{ ok: boolean }>(`/api/facts/${id}`, { method: 'DELETE' }),

  upload: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return req<{ url: string }>('/api/upload', { method: 'POST', body: fd })
  },

  genConcepts: (id: string, opts: { count?: number; userPreference?: string; keepExisting?: boolean }) =>
    req<{ project: Project; source: string; error?: string }>(`/api/projects/${id}/concepts`, {
      method: 'POST',
      body: body(opts),
    }),

  genStoryboard: (id: string, opts: { shotCount?: number; shotDurationSec?: number; userPreference?: string }) =>
    req<{ project: Project; source: string; error?: string }>(`/api/projects/${id}/storyboard`, {
      method: 'POST',
      body: body(opts),
    }),

  regenShot: (id: string, shotId: string, instruction: string) =>
    req<{ project: Project; source: string }>(`/api/projects/${id}/storyboard/shots/${shotId}/regenerate`, {
      method: 'POST',
      body: body({ instruction }),
    }),

  previewShot: (id: string, shotId: string) =>
    req<{ project: Project }>(`/api/projects/${id}/storyboard/shots/${shotId}/preview`, { method: 'POST' }),

  addShot: (id: string, afterIndex: number, role = 'scene') =>
    req<Project>(`/api/projects/${id}/storyboard/shots`, { method: 'POST', body: body({ afterIndex, role }) }),

  removeShot: (id: string, shotId: string) =>
    req<Project>(`/api/projects/${id}/storyboard/shots/${shotId}`, { method: 'DELETE' }),

  validate: (id: string) => req<ValidateResult>(`/api/projects/${id}/validate`),

  autofix: (id: string, opts: { shotId?: string; removeMissingAssets?: boolean } = {}) =>
    req<AutoFixResult>(`/api/projects/${id}/autofix`, { method: 'POST', body: body(opts) }),

  getPackage: (id: string) => req<any>(`/api/projects/${id}/package`),
  impact: (id: string, factIds: string[] = [], global = false) =>
    req<ImpactResult>(`/api/projects/${id}/impact?factIds=${factIds.join(',')}&global=${global ? 1 : 0}`),

  renderShot: (id: string, shotId: string, force = false) =>
    req<{ project: Project }>(`/api/projects/${id}/render/shots/${shotId}`, { method: 'POST', body: body({ force }) }),

  pollShot: (id: string, shotId: string) =>
    req<{ project: Project }>(`/api/projects/${id}/render/shots/${shotId}/poll`, { method: 'POST' }),

  attachShotVideo: (id: string, shotId: string, url: string) =>
    req<Project>(`/api/projects/${id}/render/shots/${shotId}/attach`, { method: 'POST', body: body({ url }) }),

  overlayShot: (id: string, shotId: string, subtitle?: string) =>
    req<{ project: Project }>(`/api/projects/${id}/render/shots/${shotId}/overlay`, {
      method: 'POST',
      body: body({ subtitle }),
    }),

  approveShotRender: (id: string, shotId: string, approved: boolean, note = '') =>
    req<Project>(`/api/projects/${id}/render/shots/${shotId}/approve`, {
      method: 'POST',
      body: body({ approved, note }),
    }),

  assemble: (id: string, force = false) =>
    req<{ project: Project; ffmpeg: boolean; manual?: { listFileContent: string; command: string } }>(
      `/api/projects/${id}/render/assemble`,
      { method: 'POST', body: body({ force }) },
    ),

  createVariant: (id: string, variable: string, instruction = '') =>
    req<{ project: Project; variant: any; source: string }>(`/api/projects/${id}/variants`, {
      method: 'POST',
      body: body({ variable, instruction }),
    }),

  deleteVariant: (id: string, variantId: string) =>
    req<Project>(`/api/projects/${id}/variants/${variantId}`, { method: 'DELETE' }),
}
