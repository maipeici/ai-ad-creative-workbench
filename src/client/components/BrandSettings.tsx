import { useState } from 'react'
import type { PhaseProps } from '../App'
import { api } from '../api'
import { Field, Section } from '../ui'

export function BrandSelector({ project, meta, patch, reloadMeta, notify }: PhaseProps) {
  const [mode, setMode] = useState<'new' | 'edit' | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const choose = async (brandGuideId: string) => {
    await patch({ brandGuideId, assets: Object.fromEntries(Object.keys(project.assets).map(k => [k, []])), facts: [], brief: { campaign: '', campaignFactId: '', sellingPoint: '' } })
  }
  const fields = [['productName', '品牌名称'], ['positioning', '产品定位'], ['productNameEn', '英文名称'], ['category', '产品品类'], ['primaryColor', '品牌主色'], ['secondaryColor', '辅助色']]
  return <div className="brand-selector">
    <div className="batch-toolbar"><select aria-label="选择品牌" className="input max-w-sm" value={project.brandGuideId || 'hxz-ad-v1'} disabled={busy} onChange={async e => { setBusy(true); try { await choose(e.target.value) } catch (error: any) { notify(error.message, 'error') } finally { setBusy(false) } }}>{meta.brands?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
      <button className="btn-ghost" onClick={() => { setMode('new'); setDraft({ productName: '', positioning: '', primaryColor: '#FF3E7F', secondaryColor: '#FFE4EE' }) }}>新增品牌</button>
      <button className="btn-ghost" onClick={() => { setMode('edit'); setDraft(Object.fromEntries(fields.map(([key]) => [key, String((meta.brandGuide.brandIdentity as any)[key] || '')]))) }}>编辑品牌</button>
    </div>
    {mode && <div className="brand-editor"><div className="business-form-grid">{fields.map(([key, label]) => <Field key={key} label={label}><input className="input" value={draft[key] || ''} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></Field>)}</div>
      <div className="batch-toolbar mt-4"><button className="btn-primary" disabled={busy || !draft.productName?.trim() || !draft.positioning?.trim()} onClick={async () => { setBusy(true); try {
        const identity = Object.fromEntries(Object.entries(draft).filter(([, value]) => value.trim()))
        if (mode === 'new') { const brand = await api.createBrand(identity); await choose(brand.id) }
        else { await api.updateBrand(project.brandGuideId || 'hxz-ad-v1', { brandIdentity: identity }); await reloadMeta() }
        setMode(null); notify('品牌资料已保存')
      } catch (e: any) { notify(e.message, 'error') } finally { setBusy(false) } }}>保存{mode === 'new' ? '并选用' : '品牌'}</button><button className="btn-ghost" onClick={() => setMode(null)}>取消</button></div>
    </div>}
  </div>
}

export function ComplianceSettings({ project, meta, reloadMeta, notify }: PhaseProps) {
  const [editing, setEditing] = useState(false)
  const [brandRules, setBrandRules] = useState<Record<string, string>>({})
  const [platformEdit, setPlatformEdit] = useState(false)
  const [platformText, setPlatformText] = useState('')
  const [url, setUrl] = useState('')
  const [version, setVersion] = useState('')
  const [busy, setBusy] = useState(false)
  const groups = [['productDisplayRules', '产品展示边界'], ['copyRules', '文案表达规则'], ['restrictions', '禁止事项'], ['reviewRules', '品牌补充要求']]
  const profile = meta.platformPolicies?.profiles.find(p => p.id === project.brief.channel)
  return <>
    <Section title="品牌审核要求" desc="审核标准只在这里维护。成片自动审核使用这份要求，无须在审核页重复填写。" right={<button className="btn-ghost" onClick={() => { setBrandRules(Object.fromEntries(groups.map(([k]) => [k, ((meta.brandGuide as any)[k] || []).join('\n')]))); setEditing(!editing) }}>{editing ? '取消编辑' : '编辑品牌要求'}</button>}>
      <div className="business-form-grid">{groups.map(([key, label]) => <Field key={key} label={label}>{editing ? <textarea className="input min-h-32" value={brandRules[key] || ''} onChange={e => setBrandRules({ ...brandRules, [key]: e.target.value })} placeholder="每行一条要求" /> : <ul className="foundation-rules">{((meta.brandGuide as any)[key] || []).map((r: string) => <li key={r}>{r}</li>)}{!((meta.brandGuide as any)[key] || []).length && <li>暂无补充要求</li>}</ul>}</Field>)}</div>
      {editing && <button className="btn-primary mt-4" disabled={busy} onClick={async () => { setBusy(true); try { await api.updateBrand(project.brandGuideId || 'hxz-ad-v1', Object.fromEntries(groups.map(([key]) => [key, (brandRules[key] || '').split('\n').map(v => v.trim()).filter(Boolean)]))); await reloadMeta(); setEditing(false); notify('品牌要求已更新，相关素材需要重新审核') } catch (e: any) { notify(e.message, 'error') } finally { setBusy(false) } }}>保存品牌要求</button>}
    </Section>
    <Section title={'平台审核规则 · ' + (profile?.name || '未选择渠道')} desc="随投放渠道自动匹配。公开通用规则与行业、版位细则分开标注；缺少规则时保留待补充状态。" right={<button className="btn-ghost" onClick={() => { setPlatformText(profile?.rules.map(r => r.label).join('\n') || ''); setUrl(profile?.sources[0]?.url || ''); setVersion(profile?.version || meta.platformPolicies?.version || ''); setPlatformEdit(!platformEdit) }}>{platformEdit ? '取消' : '维护平台规则'}</button>}>
      {platformEdit ? <><Field label="平台要求（每行一条）"><textarea className="input min-h-32" value={platformText} onChange={e => setPlatformText(e.target.value)} /></Field><div className="business-form-grid mt-3"><Field label="官方规则来源链接"><input className="input" value={url} onChange={e => setUrl(e.target.value)} /></Field><Field label="规则版本 / 发布日期"><input className="input" value={version} onChange={e => setVersion(e.target.value)} /></Field></div><button className="btn-primary mt-4" disabled={busy || !profile || !platformText.trim()} onClick={async () => { setBusy(true); try { await api.updatePlatformPolicy(profile!.id, { rules: platformText.split('\n').map(v => v.trim()).filter(Boolean), sourceUrl: url, version }); await reloadMeta(); setPlatformEdit(false); notify('平台规则已保存，已有审核需重新运行') } catch (e: any) { notify(e.message, 'error') } finally { setBusy(false) } }}>保存平台规则</button></> : <>
        <p className="business-help">{profile?.coverage === 'missing' ? profile.missing : '当前范围：通用素材要求。行业与具体版位有额外规定时，请补充后再审核。'}</p>
        <ul className="foundation-rules">{profile?.rules.map(r => <li key={r.id}>{r.label}</li>)}</ul>
        <div className="policy-sources">{profile?.sources.map(s => <a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.title} ↗ <small>查阅于 {s.checkedAt}</small></a>)}</div>
      </>}
    </Section>
  </>
}
