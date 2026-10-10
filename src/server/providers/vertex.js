import fs from 'node:fs'
import path from 'node:path'
import { config, MEDIA_DIR } from '../config.js'
import { gcpFetch, projectId } from './gcp-auth.js'

/**
 * Vertex AI Provider
 * -------------------------------------------------------------
 * Gemini 2.5        → 创意方案 / 分镜生成（严格 JSON 输出）
 * gemini-2.5-flash-image → 分镜首帧图（可吃角色参考图，保证一致性）
 * Veo 3.0           → 镜头视频生成（支持首帧图生视频）
 */

function modelBase(location = config.vertex.location) {
  const pid = projectId()
  const host =
    location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`
  return `https://${host}/v1/projects/${pid}/locations/${location}/publishers/google/models`
}

/* ----------------------------- Gemini LLM ----------------------------- */

/** 把 OpenAI 风格 messages 转成 Gemini contents + systemInstruction */
function toGeminiPayload(messages, { json = true } = {}) {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

  return {
    contents,
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: 16384,
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
    safetySettings: [
      'HARM_CATEGORY_HATE_SPEECH',
      'HARM_CATEGORY_DANGEROUS_CONTENT',
      'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      'HARM_CATEGORY_HARASSMENT',
    ].map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' })),
  }
}

export async function geminiChat(messages) {
  const { geminiModel, location } = config.vertex
  const data = await gcpFetch(`${modelBase(location)}/${geminiModel}:generateContent`, {
    method: 'POST',
    body: JSON.stringify(toGeminiPayload(messages)),
  })

  const cand = data?.candidates?.[0]
  if (!cand) throw new Error('Gemini 未返回候选内容')
  if (cand.finishReason && !['STOP', 'MAX_TOKENS'].includes(cand.finishReason)) {
    throw new Error(`Gemini 生成被中断：${cand.finishReason}`)
  }
  const text = (cand.content?.parts || [])
    .map((p) => p.text)
    .filter(Boolean)
    .join('')
  if (!text) throw new Error('Gemini 返回内容为空')
  return text
}

/* --------------------------- Gemini 图像生成 --------------------------- */

function readLocalImage(url) {
  if (!url || !url.startsWith('/media/')) return null
  const file = path.join(MEDIA_DIR, path.basename(url))
  if (!fs.existsSync(file)) return null
  const ext = path.extname(file).toLowerCase()
  const mime =
    ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.svg' ? null : 'image/jpeg'
  if (!mime) return null // SVG 占位图不作为模型输入
  return { mimeType: mime, data: fs.readFileSync(file).toString('base64') }
}

/**
 * 生成分镜首帧图。
 * refImages 会作为图像输入一起送进模型，让画面里的角色/装备贴合官方参考图，
 * 这是跨镜头角色一致性的第一道保障。
 */
export async function geminiImage({ prompt, refImages = [], extraInstruction = '', safeArea }) {
  const { imageModel, location } = config.vertex
  const parts = []

  const refs = refImages.map(readLocalImage).filter(Boolean).slice(0, 3)
  for (const r of refs) parts.push({ inlineData: r })

  const safeText = safeArea
    ? `Keep the main subject inside the central safe area: leave the top ${Math.round(safeArea.top * 100)}% and the bottom ${Math.round(safeArea.bottom * 100)}% of the frame clear of any important content.`
    : 'Keep the main subject inside the central safe area, away from the top 12% and bottom 22% of the frame.'

  parts.push({
    text:
      (refs.length
        ? 'Use the provided reference images strictly for the person appearance, outfit and vehicle. Keep the same face, body type, clothing and car colour.\n\n'
        : '') +
      `Generate a single photorealistic vertical 9:16 storyboard keyframe.\n\n${prompt}\n\n` +
      (extraInstruction ? `${extraInstruction}\n\n` : '') +
      `${safeText} No watermark.`,
  })

  const data = await gcpFetch(`${modelBase(location)}/${imageModel}:generateContent`, {
    method: 'POST',
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        // 强制竖屏 9:16，否则模型默认输出 1:1
        imageConfig: { aspectRatio: '9:16' },
      },
      safetySettings: [
        'HARM_CATEGORY_HATE_SPEECH',
        'HARM_CATEGORY_DANGEROUS_CONTENT',
        'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        'HARM_CATEGORY_HARASSMENT',
      ].map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' })),
    }),
  })

  const outParts = data?.candidates?.[0]?.content?.parts || []
  const img = outParts.find((p) => p.inlineData?.data)
  if (!img) {
    const reason = data?.candidates?.[0]?.finishReason || 'no image returned'
    throw new Error(`Gemini 图像生成失败：${reason}`)
  }
  return {
    base64: img.inlineData.data,
    mimeType: img.inlineData.mimeType || 'image/png',
  }
}

/* ------------------------------- Veo 视频 ------------------------------- */

/** Veo 3.0 仅支持固定时长，取最近的合法值 */
function normalizeDuration(sec, model) {
  const allowed = model.startsWith('veo-2') ? [5, 6, 7, 8] : [4, 6, 8]
  const target = Number(sec) || 4
  return allowed.reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best), allowed[0])
}

/**
 * 提交 Veo 生成任务。
 * 若提供 firstFrame（通常是 Phase 4 生成的分镜首帧图），则走图生视频，
 * 角色与构图一致性显著优于纯文生视频。
 */
export async function veoSubmit({ prompt, negativePrompt, durationSec, aspectRatio = '9:16', firstFrame, model, params = {} }) {
  const veoModel = model || config.vertex.veoModel
  const location = config.vertex.location === 'global' ? 'us-central1' : config.vertex.location

  const instance = { prompt }
  const frame = firstFrame ? readLocalImage(firstFrame) : null
  if (frame) {
    instance.image = { bytesBase64Encoded: frame.data, mimeType: frame.mimeType }
  }

  const parameters = {
    sampleCount: 1,
    durationSeconds: normalizeDuration(durationSec, veoModel),
    aspectRatio,
    // 环境音由 Veo 生成（街道声、车门声等），人声口播由 Cloud TTS 单独合成后混入，
    // 这样口播文案与字幕能严格一致，不依赖模型「说对话」。
    generateAudio: config.video.generateAudio !== false,
    ...(negativePrompt ? { negativePrompt: negativePrompt.slice(0, 2000) } : {}),
    ...params,
  }

  const data = await gcpFetch(`${modelBase(location)}/${veoModel}:predictLongRunning`, {
    method: 'POST',
    body: JSON.stringify({ instances: [instance], parameters }),
  })

  if (!data?.name) throw new Error('Veo 未返回操作名称')
  return {
    operationName: data.name,
    model: veoModel,
    durationSeconds: parameters.durationSeconds,
    usedFirstFrame: Boolean(frame),
  }
}

/** 轮询 Veo 任务；完成后把视频写入 data/runtime/media 并返回可访问路径 */
export async function veoPoll({ operationName, model, fileHint = 'shot' }) {
  const veoModel = model || config.vertex.veoModel
  const location = config.vertex.location === 'global' ? 'us-central1' : config.vertex.location

  const op = await gcpFetch(`${modelBase(location)}/${veoModel}:fetchPredictOperation`, {
    method: 'POST',
    body: JSON.stringify({ operationName }),
  })

  if (op.error) {
    throw new Error(`Veo 生成失败：${op.error.message || JSON.stringify(op.error).slice(0, 300)}`)
  }
  if (!op.done) return { status: 'running' }

  const resp = op.response || {}
  const videos = resp.videos || resp.predictions || resp.generatedSamples || []

  if (!videos.length) {
    const filtered = resp.raiMediaFilteredCount
    const reasons = (resp.raiMediaFilteredReasons || []).join('; ')
    throw new Error(
      filtered
        ? `Veo 输出被安全策略过滤（${filtered} 个）${reasons ? '：' + reasons : ''}。请调整 Prompt 或降低暴力/血腥相关描述。`
        : 'Veo 未返回视频内容',
    )
  }

  const v = videos[0]
  const b64 = v.bytesBase64Encoded || v.video?.bytesBase64Encoded
  const gcsUri = v.gcsUri || v.video?.gcsUri

  if (b64) {
    const file = `${fileHint}-${Date.now()}.mp4`
    fs.writeFileSync(path.join(MEDIA_DIR, file), Buffer.from(b64, 'base64'))
    return { status: 'succeeded', url: `/media/${file}` }
  }
  if (gcsUri) return { status: 'succeeded', url: gcsUri, note: '视频位于 GCS，需另行下载后才能本地合成' }

  throw new Error('Veo 返回结构无法解析')
}
