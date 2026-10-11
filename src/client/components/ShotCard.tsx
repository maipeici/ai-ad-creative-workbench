import { useEffect, useState } from 'react'
import type { AssetItem, Issue, Meta, RenderMode, Shot } from '../types'
import { Badge, CopyButton, IssueRow, RenderModeBadge, RoleBadge, Spinner } from '../ui'
import { countCnClient } from '../utils'

interface Props {
  shot: Shot
  meta: Meta
  selectedAssetIds: string[]
  selectedFactIds: string[]
  issues?: Issue[]
  onChange: (patch: Partial<Shot>) => void
  onRegen?: (instruction: string) => Promise<void>
  onPreview?: () => Promise<void>
  onDelete?: () => void
  readOnly?: boolean
  contentOnly?: boolean
  versionAllowed?: string[]
}

export default function ShotCard({
  shot,
  meta,
  selectedAssetIds,
  selectedFactIds,
  issues = [],
  onChange,
  onRegen,
  onPreview,
  onDelete,
  readOnly,
  contentOnly,
  versionAllowed,
}: Props) {
  const [local, setLocal] = useState<Shot>(shot)
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState<'regen' | 'preview' | null>(null)
  const [showPrompt, setShowPrompt] = useState(false)
  const [advanced, setAdvanced] = useState(false)

  useEffect(() => setLocal(shot), [shot])

  const bg = meta.brandGuide
  const editable = (field: string) => {
    if (readOnly) return false
    if (!versionAllowed) return true
    const groups: Record<string, string[]> = { casting: ['personRefs'], performance: ['action', 'actionCn', 'titleCn'], camera: ['cameraAngle', 'cameraMovement'], setting: ['sceneRefs'], wording: ['vo', 'subtitle'] }
    if (shot.role === 'cta' && ['vo', 'subtitle'].includes(field)) return false
    return ['prompt', 'negativePrompt', 'factRefs'].includes(field) || versionAllowed.some(key => groups[key]?.includes(field))
  }
  const assetById = new Map(meta.assets.items.map((i) => [i.id, i]))
  const pool: AssetItem[] = selectedAssetIds.map((id) => assetById.get(id)).filter(Boolean) as AssetItem[]
  const personPool = pool.filter((a) => ['person', 'outfit'].includes(a.category))
  const vehiclePool = pool.filter((a) => a.category === 'vehicle')
  const scenePool = pool.filter((a) => ['scene', 'prop'].includes(a.category))
  const uiPool = pool.filter((a) => ['productUI', 'brand', 'overlay'].includes(a.category))

  const commit = (patch: Partial<Shot>) => {
    if (readOnly || Object.keys(patch).some(field => !editable(field))) return
    setLocal((s) => ({ ...s, ...patch }))
    onChange(patch)
  }

  const toggleRef = (field: 'personRefs' | 'vehicleRefs' | 'sceneRefs' | 'uiRefs' | 'factRefs', id: string) => {
    const cur = (local[field] as string[]) || []
    commit({ [field]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] } as Partial<Shot>)
  }

  const voChars = countCnClient(local.vo)
  const voBudget = Math.floor((local.durationSec || 0) * 5 * 0.85)
  const voOver = voChars > voBudget
  const blockers = issues.filter((i) => i.severity === 'block')

  return (
    <div className={`card overflow-hidden flex flex-col ${blockers.length ? 'border-red-800/60' : ''}`}>
      <div className="relative bg-ink-900 aspect-[9/16] max-h-56 grid place-items-center border-b border-ink-600">
        {local.preview?.url ? (
          <img src={local.preview.url} alt="" className="w-full h-full object-contain" />
        ) : (
          <div className="text-center px-4">
            <div className="text-3xl font-black text-ink-600">#{local.index}</div>
            <p className="text-[10px] text-slate-600 mt-1">尚未生成预览图</p>
          </div>
        )}
        <div className="absolute top-2 left-2 flex gap-1 flex-wrap">
          <Badge tone="brand">#{local.index}</Badge>
          <RoleBadge role={local.role} />
          <Badge>{local.durationSec}s</Badge>
        </div>
        <div className="absolute top-2 right-2">
          <RenderModeBadge mode={local.renderMode} />
        </div>
      </div>

      <div className="p-3 space-y-2.5 flex-1">
        {local.referenceUse&&<div className="reference-shot"><strong>参考原片 · {local.referenceUse.sourceTiming}</strong><p>{local.referenceUse.adaptation}</p></div>}
        <input
          className="w-full bg-transparent text-xs font-semibold text-slate-100 focus:outline-none"
          value={local.titleCn}
          disabled={!editable('titleCn')}
          onChange={(e) => setLocal({ ...local, titleCn: e.target.value })}
          onBlur={(e) => commit({ titleCn: e.target.value })}
        />

        {blockers.length > 0 && (
          <div className="space-y-1">
            {issues.map((iss, i) => (
              <IssueRow key={i} severity={iss.severity} reason={iss.reason} term={iss.term} />
            ))}
          </div>
        )}

        {!advanced && <div className="shot-simple space-y-3">
          <Mini label="画面内容"><textarea className="input" value={local.actionCn || ''} placeholder="用中文描述这一镜发生什么" disabled={!editable('actionCn')} onChange={e => setLocal({ ...local, actionCn: e.target.value })} onBlur={e => commit({ actionCn: e.target.value })} /></Mini>
          <Mini label="口播"><textarea className="input" value={local.vo} disabled={!editable('vo')} onChange={e => setLocal({ ...local, vo: e.target.value })} onBlur={e => commit({ vo: e.target.value })} /></Mini>
          <Mini label="字幕"><input className="input" value={local.subtitle} disabled={!editable('subtitle')} onChange={e => setLocal({ ...local, subtitle: e.target.value })} onBlur={e => commit({ subtitle: e.target.value })} /></Mini>
          <p>时长 {local.durationSec} 秒 · {local.factRefs?.length || 0} 条事实依据</p>
        </div>}
        <button className="text-link !text-xs" onClick={() => setAdvanced(!advanced)}>{advanced ? '收起高级制作设置' : '展开高级制作设置'}</button>
        <fieldset hidden={!advanced} disabled={contentOnly} className="space-y-2.5">
        <div className="grid grid-cols-2 gap-2">
          <Mini label="镜头作用">
            <select
              className="input !py-1 !text-[11px]"
              value={local.role}
              disabled={!editable('role')}
              onChange={(e) => commit({ role: e.target.value })}
            >
              {bg.shotRoles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Mini>
          <Mini label="生成方式">
            <select
              className="input !py-1 !text-[11px]"
              value={local.renderMode}
              disabled={!editable('renderMode')}
              onChange={(e) => commit({ renderMode: e.target.value as RenderMode })}
            >
              <option value="ai">AI 生成</option>
              <option value="overlay">AI + 后期叠加</option>
              <option value="asset">使用已有素材</option>
            </select>
          </Mini>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Mini label="镜头角度">
            <select
              className="input !py-1 !text-[11px]"
              value={local.cameraAngle}
              disabled={!editable('cameraAngle')}
              onChange={(e) => commit({ cameraAngle: e.target.value })}
            >
              {[local.cameraAngle, ...bg.cameraStyle.defaultAngles.filter((a) => a !== local.cameraAngle)].map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </Mini>
          <Mini label="运镜">
            <select
              className="input !py-1 !text-[11px]"
              value={local.cameraMovement}
              disabled={!editable('cameraMovement')}
              onChange={(e) => commit({ cameraMovement: e.target.value })}
            >
              {[local.cameraMovement, ...bg.cameraStyle.defaultMovements.filter((a) => a !== local.cameraMovement)].map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </Mini>
        </div>

        <Mini label={`口播 ${voChars}/${voBudget} 字`} warn={voOver}>
          <textarea
            className={`input !py-1 !text-[11px] h-12 resize-none ${voOver ? '!border-amber-700' : ''}`}
            placeholder="中文口播，无则留空"
            value={local.vo}
            disabled={!editable('vo')}
            onChange={(e) => setLocal({ ...local, vo: e.target.value })}
            onBlur={(e) => commit({ vo: e.target.value })}
          />
        </Mini>

        <Mini label={`字幕（单行 ≤14 字，当前 ${countCnClient(local.subtitle)}）`} warn={countCnClient(local.subtitle) > 14}>
          <input
            className="input !py-1 !text-[11px]"
            placeholder="后期烧录，100% 准确"
            value={local.subtitle}
            disabled={!editable('subtitle')}
            onChange={(e) => setLocal({ ...local, subtitle: e.target.value })}
            onBlur={(e) => commit({ subtitle: e.target.value })}
          />
        </Mini>

        <Mini label="画面动作（英文，送模型）">
          <textarea
            className="input !py-1 !text-[11px] h-12 resize-none"
            value={local.action}
            disabled={!editable('action')}
            onChange={(e) => setLocal({ ...local, action: e.target.value })}
            onBlur={(e) => commit({ action: e.target.value })}
          />
        </Mini>

        <div className="grid grid-cols-2 gap-2">
          <Mini label="时长（秒）">
            <input
              type="number"
              min={1}
              max={10}
              step={0.5}
              className="input !py-1 !text-[11px]"
              value={local.durationSec}
              disabled={!editable('durationSec')}
              onChange={(e) => commit({ durationSec: Number(e.target.value) })}
            />
          </Mini>
          <Mini label="音效">
            <input
              className="input !py-1 !text-[11px]"
              value={local.sfx || ''}
              disabled={!editable('sfx')}
              onChange={(e) => setLocal({ ...local, sfx: e.target.value })}
              onBlur={(e) => commit({ sfx: e.target.value })}
            />
          </Mini>
        </div>

        <RefRow label="人物参考" pool={personPool} selected={local.personRefs} onToggle={(id) => toggleRef('personRefs', id)} disabled={!editable('personRefs')} />
        <RefRow label="车辆参考" pool={vehiclePool} selected={local.vehicleRefs} onToggle={(id) => toggleRef('vehicleRefs', id)} disabled={!editable('vehicleRefs')} />
        <RefRow label="场景参考" pool={scenePool} selected={local.sceneRefs} onToggle={(id) => toggleRef('sceneRefs', id)} disabled={!editable('sceneRefs')} />

        <Mini label="叠加素材（界面 / Logo / 优惠卡）">
          <div className="flex flex-wrap gap-1">
            {uiPool.length === 0 && <span className="text-[10px] text-slate-600">Phase 1 未选界面或品牌素材</span>}
            {uiPool.map((a) => {
              const on = (local.uiRefs || []).includes(a.id)
              const ready = Boolean(a.refImage)
              return (
                <button
                  key={a.id}
                  disabled={!editable('uiRefs')}
                  className={`${on ? (ready ? 'chip-on' : 'chip-off !border-red-700 !text-red-300') : 'chip-off'} !text-[10px] !px-2 !py-0.5`}
                  onClick={() => toggleRef('uiRefs', a.id)}
                  title={ready ? '' : '官方素材未上传'}
                >
                  {a.nameCn || a.name}
                  {!ready && ' ⚠'}
                </button>
              )
            })}
          </div>
        </Mini>

        <Mini label="事实依据（涉及金额/活动必填）">
          <div className="flex flex-wrap gap-1">
            {selectedFactIds.length === 0 && <span className="text-[10px] text-slate-600">Phase 1 未选事实</span>}
            {selectedFactIds.map((id) => {
              const f = meta.facts.facts.find((x) => x.id === id)
              if (!f) return null
              const on = (local.factRefs || []).includes(id)
              return (
                <button
                  key={id}
                  disabled={!editable('factRefs')}
                  className={`${on ? 'chip-on' : 'chip-off'} !text-[10px] !px-2 !py-0.5 ${f.status !== 'confirmed' ? '!text-amber-400' : ''}`}
                  onClick={() => toggleRef('factRefs', id)}
                >
                  {f.title}
                  {f.status !== 'confirmed' && ' ⚠'}
                </button>
              )
            })}
          </div>
        </Mini>

        {(local.overlayItems || []).length > 0 && (
          <Mini label="需后期叠加">
            <div className="flex flex-wrap gap-1">
              {local.overlayItems.map((o, i) => (
                <span key={i} className="tag bg-brand/15 text-brand-soft">
                  {o}
                </span>
              ))}
            </div>
          </Mini>
        )}

        <button
          className="w-full text-left text-[10px] text-slate-500 hover:text-slate-300 border-t border-ink-600 pt-2"
          onClick={() => setShowPrompt((v) => !v)}
        >
          {showPrompt ? '▾' : '▸'} Prompt / Negative
        </button>
        {showPrompt && (
          <div className="space-y-2">
            <Mini label="Prompt（英文）">
              <textarea
                className="input !text-[10px] h-24 resize-none font-mono leading-relaxed"
                value={local.prompt}
                disabled={!editable('prompt')}
                onChange={(e) => setLocal({ ...local, prompt: e.target.value })}
                onBlur={(e) => commit({ prompt: e.target.value })}
              />
              <div className="flex justify-end mt-1">
                <CopyButton text={local.prompt} />
              </div>
            </Mini>
            <Mini label="镜头专属 Negative">
              <textarea
                className="input !text-[10px] h-12 resize-none font-mono"
                value={local.negativePrompt}
                disabled={!editable('negativePrompt')}
                onChange={(e) => setLocal({ ...local, negativePrompt: e.target.value })}
                onBlur={(e) => commit({ negativePrompt: e.target.value })}
              />
            </Mini>
          </div>
        )}
        </fieldset>
      </div>

      {!readOnly && !contentOnly && (
        <div className="p-3 pt-0 space-y-2">
          <input
            className="input !py-1 !text-[11px]"
            placeholder="重生成指令：例如 换成雨天、加入行李箱"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
          <div className="flex gap-1.5">
            {onRegen && (
              <button
                className="btn-ghost !py-1 !text-[11px] flex-1"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy('regen')
                  try {
                    await onRegen(instruction)
                    setInstruction('')
                  } finally {
                    setBusy(null)
                  }
                }}
              >
                {busy === 'regen' ? <Spinner /> : '↻'} 重生成
              </button>
            )}
            {onPreview && (
              <button
                className="btn-ghost !py-1 !text-[11px] flex-1"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy('preview')
                  try {
                    await onPreview()
                  } finally {
                    setBusy(null)
                  }
                }}
              >
                {busy === 'preview' ? <Spinner /> : '🖼'} 预览图
              </button>
            )}
            {onDelete && (
              <button className="btn-danger !py-1 !text-[11px] !px-2" onClick={onDelete}>
                删
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Mini({ label, children, warn }: { label: string; children: React.ReactNode; warn?: boolean }) {
  return (
    <div>
      <div className={`text-[10px] mb-1 ${warn ? 'text-amber-400' : 'text-slate-500'}`}>{label}</div>
      {children}
    </div>
  )
}

function RefRow({
  label,
  pool,
  selected,
  onToggle,
  disabled,
}: {
  label: string
  pool: AssetItem[]
  selected: string[]
  onToggle: (id: string) => void
  disabled?: boolean
}) {
  if (!pool.length) return null
  return (
    <Mini label={label}>
      <div className="flex flex-wrap gap-1">
        {pool.map((a) => (
          <button
            key={a.id}
            disabled={disabled}
            className={`${(selected || []).includes(a.id) ? 'chip-on' : 'chip-off'} !text-[10px] !px-2 !py-0.5`}
            onClick={() => onToggle(a.id)}
          >
            {a.nameCn || a.name}
          </button>
        ))}
      </div>
    </Mini>
  )
}
