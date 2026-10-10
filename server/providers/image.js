import fsp from 'node:fs/promises'
import path from 'node:path'
import { config, MEDIA_DIR } from '../config.js'
import { geminiImage } from './vertex.js'

function escapeXml(s) {
  return String(s || '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c])
}

function wrap(text, perLine, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const lines = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > perLine) {
      lines.push(cur.trim())
      cur = w
      if (lines.length >= maxLines) break
    } else {
      cur = `${cur} ${w}`
    }
  }
  if (lines.length < maxLines && cur.trim()) lines.push(cur.trim())
  return lines
}

const ROLE_LABEL = {
  hook: '钩子 HOOK',
  scene: '共鸣 SCENE',
  product: '产品 PRODUCT',
  proof: '佐证 PROOF',
  cta: '引导 CTA',
}

/** 无图像 API 时的 9:16 占位图，标注镜头作用、安全区、叠加需求 */
function placeholderSvg({ shot, globalContext, safeArea }) {
  const lines = wrap(shot.prompt, 38, 8)
  const top = Math.round((safeArea?.top ?? 0.12) * 1280)
  const bottomY = Math.round((1 - (safeArea?.bottom ?? 0.22)) * 1280)
  const role = ROLE_LABEL[shot.role] || shot.role || ''
  const overlays = (shot.overlayItems || []).join(' / ')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#2b3a4a"/><stop offset="100%" stop-color="#14181f"/>
  </linearGradient></defs>
  <rect width="720" height="1280" fill="url(#g)"/>
  <rect x="0" y="0" width="720" height="${top}" fill="#000" opacity="0.4"/>
  <rect x="0" y="${bottomY}" width="720" height="${1280 - bottomY}" fill="#000" opacity="0.4"/>
  <line x1="0" y1="${top}" x2="720" y2="${top}" stroke="#FF4E8B" stroke-dasharray="8 8" opacity="0.6"/>
  <line x1="0" y1="${bottomY}" x2="720" y2="${bottomY}" stroke="#FF4E8B" stroke-dasharray="8 8" opacity="0.6"/>
  <text x="40" y="${top + 60}" fill="#FF4E8B" font-size="34" font-family="Segoe UI, sans-serif" font-weight="700">#${shot.index} ${escapeXml(role)}</text>
  <text x="40" y="${top + 100}" fill="#cbd5e1" font-size="24" font-family="Segoe UI, sans-serif">${shot.durationSec}s · ${escapeXml(shot.renderMode || 'ai')}</text>
  <text x="40" y="${top + 160}" fill="#ffffff" font-size="26" font-family="Segoe UI, sans-serif">${escapeXml((shot.cameraAngle || '').slice(0, 34))}</text>
  <text x="40" y="${top + 196}" fill="#94a3b8" font-size="22" font-family="Segoe UI, sans-serif">${escapeXml((shot.cameraMovement || '').slice(0, 34))}</text>
  ${lines.map((l, i) => `<text x="40" y="${top + 260 + i * 36}" fill="#e2e8f0" font-size="22" font-family="Segoe UI, sans-serif">${escapeXml(l)}</text>`).join('\n  ')}
  ${shot.vo ? `<text x="40" y="${bottomY - 120}" fill="#FFD5E4" font-size="24" font-family="Microsoft YaHei, sans-serif">口播：${escapeXml(shot.vo.slice(0, 22))}</text>` : ''}
  ${shot.subtitle ? `<text x="40" y="${bottomY - 80}" fill="#ffffff" font-size="26" font-family="Microsoft YaHei, sans-serif">字幕：${escapeXml(shot.subtitle.slice(0, 20))}</text>` : ''}
  ${overlays ? `<text x="40" y="${bottomY - 36}" fill="#FF4E8B" font-size="22" font-family="Microsoft YaHei, sans-serif">叠加：${escapeXml(overlays.slice(0, 26))}</text>` : ''}
  <text x="40" y="${bottomY + 50}" fill="#64748b" font-size="20" font-family="Segoe UI, sans-serif">SAFE AREA MARKED · 9:16 PLACEHOLDER</text>
</svg>`
}

async function callImageApi({ prompt }) {
  const { baseUrl, apiKey, model, size } = config.image
  const res = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, prompt, size, n: 1 }),
  })
  if (!res.ok) throw new Error(`Image API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  const item = data?.data?.[0]
  if (item?.b64_json) return { b64: item.b64_json }
  if (item?.url) return { url: item.url }
  throw new Error('Image API 未返回图片')
}

/**
 * 生成分镜首帧图。
 * 广告场景下额外强调：禁止任何文字 / App 界面 / Logo，这些一律后期叠加。
 */
export async function generateShotPreview({ projectId, shot, globalContext, prompt, refImages = [], safeArea }) {
  const stamp = Date.now()

  if (config.vertex.enabled) {
    try {
      const { base64, mimeType } = await geminiImage({
        prompt,
        refImages,
        extraInstruction:
          'This is a storyboard keyframe for a Chinese ride-hailing app advertisement. It must look like authentic real-life footage, NOT a polished studio commercial. ' +
          'STRICTLY NO text, NO Chinese characters, NO app interface, NO logo, NO price tag, NO captions — all of those are composited in post production. ' +
          'If a phone appears, its screen must be a plain dark switched-off screen (near black, subtle reflection). ' +
          'Never render a green screen, chroma key green, blue screen or any coloured placeholder on the phone display.',
        safeArea,
      })
      const ext = mimeType.includes('jpeg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : 'png'
      const file = `preview-${projectId}-${shot.id}-${stamp}.${ext}`
      await fsp.writeFile(path.join(MEDIA_DIR, file), Buffer.from(base64, 'base64'))
      return { url: `/media/${file}`, source: 'gemini-image' }
    } catch (err) {
      console.error('[image] Gemini 图像生成失败，回退:', err.message)
    }
  }

  if (config.image.enabled) {
    try {
      const out = await callImageApi({ prompt })
      if (out.url) return { url: out.url, source: 'image-api' }
      const file = `preview-${projectId}-${shot.id}-${stamp}.png`
      await fsp.writeFile(path.join(MEDIA_DIR, file), Buffer.from(out.b64, 'base64'))
      return { url: `/media/${file}`, source: 'image-api' }
    } catch (err) {
      console.error('[image] 调用失败，回退占位图:', err.message)
    }
  }

  const file = `preview-${projectId}-${shot.id}-${stamp}.svg`
  await fsp.writeFile(path.join(MEDIA_DIR, file), placeholderSvg({ shot, globalContext, safeArea }), 'utf8')
  return { url: `/media/${file}`, source: 'placeholder' }
}
