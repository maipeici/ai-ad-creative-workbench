import path from 'node:path'
import { config, MEDIA_DIR, resolvedVideoMode } from '../config.js'
import { hasFfmpeg, makeMockClip } from './ffmpeg.js'
import { veoSubmit, veoPoll } from './vertex.js'

/**
 * 视频生成 Provider
 * -------------------------------------------------------------
 * mode = vertex : Google Veo 3.0（真实 AI 视频，支持首帧图生视频）
 * mode = http   : 调用你自己的视频网关（可灵 / Runway / Vidu / 自建服务）
 * mode = mock   : 本地生成占位片段（需 ffmpeg），用于跑通流程 / 演示 / 节奏验证
 * mode = manual : 只产出 Prompt，由运营在外部平台生成后回传视频 URL
 *
 * http 模式请求体（可按你的网关字段在 mapRequest 中调整）：
 *   { model, prompt, negative_prompt, duration, aspect_ratio, image_urls, ...params }
 * 期望响应：{ id } 或 { url } 或 { data: { task_id | video_url } }
 */

function mapRequest({ model, prompt, negativePrompt, durationSec, aspectRatio, refImages, params }) {
  return {
    model,
    prompt,
    negative_prompt: negativePrompt,
    duration: durationSec,
    aspect_ratio: aspectRatio,
    image_urls: refImages || [],
    ...(params || {}),
  }
}

function readTaskId(data) {
  return data?.id || data?.task_id || data?.data?.task_id || data?.data?.id || null
}

function readVideoUrl(data) {
  return (
    data?.url ||
    data?.video_url ||
    data?.data?.video_url ||
    data?.data?.url ||
    data?.data?.works?.[0]?.video?.resource ||
    data?.output?.[0] ||
    null
  )
}

function readStatus(data) {
  const s = String(data?.status || data?.data?.status || data?.task_status || '').toLowerCase()
  if (['succeed', 'success', 'succeeded', 'completed', 'finished'].includes(s)) return 'succeeded'
  if (['failed', 'error', 'fail'].includes(s)) return 'failed'
  if (s) return 'running'
  return readVideoUrl(data) ? 'succeeded' : 'running'
}

export async function submitShot({ projectId, shot, compiled, model, params }) {
  const mode = resolvedVideoMode()

  if (mode === 'manual') {
    return {
      status: 'manual',
      message: '手动模式：请复制 Prompt 到外部视频平台生成，完成后回传视频 URL。',
    }
  }

  if (mode === 'vertex') {
    // 有分镜首帧图时走图生视频，角色与构图一致性明显更好
    const firstFrame = shot.preview?.url && !shot.preview.url.endsWith('.svg') ? shot.preview.url : null
    const submitted = await veoSubmit({
      prompt: compiled.prompt,
      negativePrompt: compiled.negativePrompt,
      durationSec: compiled.durationSec,
      aspectRatio: compiled.aspectRatio,
      firstFrame,
      model: model || config.video.model || undefined,
      params,
    })
    return {
      status: 'running',
      taskId: submitted.operationName,
      backend: 'vertex',
      veoModel: submitted.model,
      actualDurationSec: submitted.durationSeconds,
      usedFirstFrame: submitted.usedFirstFrame,
      message: `已提交 Veo 生成任务（${submitted.durationSeconds}s${submitted.usedFirstFrame ? ' · 图生视频' : ' · 文生视频'}），通常需要 30–90 秒。`,
    }
  }

  if (mode === 'http') {
    if (!config.video.apiUrl) throw new Error('VIDEO_MODE=http 但未配置 VIDEO_API_URL')
    const res = await fetch(config.video.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.video.apiKey ? { Authorization: `Bearer ${config.video.apiKey}` } : {}),
      },
      body: JSON.stringify(
        mapRequest({
          model: model || config.video.model,
          prompt: compiled.prompt,
          negativePrompt: compiled.negativePrompt,
          durationSec: compiled.durationSec,
          aspectRatio: compiled.aspectRatio,
          refImages: compiled.refImages,
          params,
        }),
      ),
    })
    if (!res.ok) throw new Error(`Video API ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = await res.json()
    const url = readVideoUrl(data)
    if (url) return { status: 'succeeded', url, raw: data }
    const taskId = readTaskId(data)
    if (!taskId) throw new Error('Video API 未返回任务 ID 或视频地址')
    return { status: 'running', taskId, raw: data }
  }

  // mock
  if (!(await hasFfmpeg())) {
    return {
      status: 'simulated',
      message: '未检测到 ffmpeg，已模拟生成（无实际视频文件）。安装 ffmpeg 后可产出占位片段与合成成片。',
    }
  }
  const file = `shot-${projectId}-${shot.id}-${Date.now()}.mp4`
  await makeMockClip({
    outFile: path.join(MEDIA_DIR, file),
    seconds: compiled.durationSec,
    index: shot.index,
  })
  return { status: 'succeeded', url: `/media/${file}` }
}

export async function pollShot(taskId, entry = {}) {
  // Vertex / Veo 长时操作
  if (entry.backend === 'vertex' || String(taskId).includes('/operations/')) {
    return veoPoll({
      operationName: taskId,
      model: entry.veoModel,
      fileHint: `shot-${entry.shotId || 'veo'}`,
    })
  }

  if (!config.video.statusUrl) throw new Error('未配置 VIDEO_STATUS_URL，无法查询任务状态')
  const url = config.video.statusUrl.replace('{id}', encodeURIComponent(taskId))
  const res = await fetch(url, {
    headers: config.video.apiKey ? { Authorization: `Bearer ${config.video.apiKey}` } : {},
  })
  if (!res.ok) throw new Error(`Video status ${res.status}`)
  const data = await res.json()
  return { status: readStatus(data), url: readVideoUrl(data), raw: data }
}
