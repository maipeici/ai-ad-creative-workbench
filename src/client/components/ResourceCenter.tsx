import { useEffect, useState } from 'react'
import type { Meta, Project, WorkspaceResources } from '../types'
import { api } from '../api'
import Phase1 from '../phases/Phase1Foundation'
import { Field, Section, Spinner } from '../ui'

export default function ResourceCenter({ meta, reloadMeta, notify, onReferences }: { meta: Meta; reloadMeta: () => Promise<void>; notify: (message: string, tone?: 'error' | 'ok') => void; onReferences: () => void }) {
  const [workspace, setWorkspace] = useState<WorkspaceResources | null>(null)
  const [identity, setIdentity] = useState(meta.brandGuide.brandIdentity)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { void api.workspace().then(setWorkspace).catch(e => setError(e.message)) }, [])
  const save = async (changes: Partial<WorkspaceResources>) => {
    setBusy(true)
    try { setWorkspace(await api.saveWorkspace(changes)); await reloadMeta(); notify('默认资料已保存，新任务会自动继承') }
    catch (e: any) { setError(e.message); notify(e.message, 'error'); throw e }
    finally { setBusy(false) }
  }
  if (!workspace) return <div className="business-page">{error || <Spinner />}</div>
  const resourceProject: Project = { id: 'workspace-defaults', name: '共享资料', createdAt: '', updatedAt: workspace.updatedAt || '', phase: 1,
    assets: workspace.defaults.assets, facts: workspace.defaults.facts,
    brief: { channel: '', audience: '', scene: '', campaign: '', sellingPoint: '', goal: '', tone: '', cta: '', durationSec: 15, reference: '', constraints: '', notes: '' },
    concepts: [], selectedConceptId: null, storyboard: null, review: { approved: false, approvedAt: null, checklist: {}, notes: '' },
    render: { model: '', params: {}, shots: {}, finalVideo: null, cover: null }, variants: [],
  }
  return <div className="business-page">
    <div className="business-heading"><div><p className="eyebrow">RESOURCE CENTER</p><h1>资料中心</h1><p>维护一次，持续复用。勾选常用素材与已确认事实，新任务自动继承；已有任务保留原来的选用范围。</p></div><button className="btn-ghost" onClick={onReferences}>打开统一参考视频库 →</button></div>
    <Section title="品牌档案" desc="品牌定位与识别信息在这里维护。已有项目继续关联此品牌，相关内容变更后会重新校验。" right={<button className="btn-ghost" onClick={() => { setIdentity(meta.brandGuide.brandIdentity); setEditing(!editing) }}>{editing ? '收起编辑' : '编辑品牌资料'}</button>}>
      {editing ? <><div className="business-form-grid">{([['productName', '品牌名称'], ['productNameEn', '英文名称'], ['category', '产品品类'], ['positioning', '产品定位'], ['primaryColor', '品牌主色'], ['secondaryColor', '辅助色']] as const).map(([key, label]) => <Field key={key} label={label}><input className="input" value={identity[key]} onChange={e => setIdentity({ ...identity, [key]: e.target.value })} /></Field>)}</div><button className="btn-primary mt-4" disabled={busy} onClick={() => void save({ brandIdentity: identity }).then(() => setEditing(false)).catch(() => {})}>保存品牌档案</button></> : <p>{meta.brandGuide.brandIdentity.productName} · {meta.brandGuide.brandIdentity.positioning}</p>}
    </Section>
    {error && <p role="alert" className="inspiration-error">{error}</p>}
    <Phase1 project={resourceProject} meta={meta} resourceMode patch={async changes => { await save({ defaults: { ...workspace.defaults, ...changes } as WorkspaceResources['defaults'] }) }} setProject={() => {}} reloadMeta={reloadMeta} notify={notify} goto={onReferences} openReferences={onReferences} />
  </div>
}
