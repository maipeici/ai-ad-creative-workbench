import fsp from 'node:fs/promises'
import path from 'node:path'
import { config, MEDIA_DIR } from '../config.js'
import { getAccessToken } from './gcp-auth.js'

/**
 * 口播配音（Google Cloud Text-to-Speech）
 * ---------------------------------------------------------------
 * 分镜里的 vo 字段此前只是文本，从未变成声音，导致成片没有人声。
 * 本模块把 vo 合成为中文配音，再由 ffmpeg 混入镜头音轨。
 *
 * 语速策略：
 *   广告口播需要「刚好说完」。这里按镜头时长反推语速，
 *   若默认语速说不完则适度加快（上限 1.35，超过会失真），
 *   仍说不完则返回超时信息，提示运营精简文案或加长镜头。
 */

const ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize'

/** 中文配音音色预设 —— 对应品牌规范里的内容基调 */
export const VOICE_PRESETS = {
  'relatable-female': {
    name: '亲和女声',
    voice: { languageCode: 'cmn-CN', name: 'cmn-CN-Wavenet-A', ssmlGender: 'FEMALE' },
    rate: 1.05,
    pitch: 0.5,
    desc: '日常口语、痛点共鸣，适合通勤与生活场景',
  },
  'energetic-female': {
    name: '活力女声',
    voice: { languageCode: 'cmn-CN', name: 'cmn-CN-Wavenet-D', ssmlGender: 'FEMALE' },
    rate: 1.15,
    pitch: 1.5,
    desc: '节奏偏快、情绪上扬，适合优惠与促销',
  },
  'steady-male': {
    name: '稳重男声',
    voice: { languageCode: 'cmn-CN', name: 'cmn-CN-Wavenet-B', ssmlGender: 'MALE' },
    rate: 1.0,
    pitch: -1,
    desc: '偏理性叙述，适合产品功能讲解',
  },
  'friendly-male': {
    name: '亲切男声',
    voice: { languageCode: 'cmn-CN', name: 'cmn-CN-Wavenet-C', ssmlGender: 'MALE' },
    rate: 1.08,
    pitch: 0,
    desc: '真人口碑感，适合第一人称分享',
  },
}

export const DEFAULT_VOICE = 'relatable-female'

/** 按内容基调挑默认音色 */
export function voiceForTone(tone) {
  const map = {
    relatable: 'relatable-female',
    'direct-benefit': 'energetic-female',
    humorous: 'energetic-female',
    informative: 'steady-male',
    testimonial: 'friendly-male',
    urgent: 'energetic-female',
  }
  return map[tone] || DEFAULT_VOICE
}

function cnLen(text) {
  return (String(text || '').match(/[\u4e00-\u9fa5a-zA-Z0-9]/g) || []).length
}

/**
 * 合成单段口播。
 * @returns { file, url, rate, estimatedSec, overflow }
 */
export async function synthesizeVo({ text, voicePreset, targetSec, baseName }) {
  const clean = String(text || '').trim()
  if (!clean) return null

  const preset = VOICE_PRESETS[voicePreset] || VOICE_PRESETS[DEFAULT_VOICE]

  // 按目标时长反推语速：中文 Wavenet 约 4.6 字/秒（rate=1.0）
  let rate = preset.rate
  let overflow = false
  if (targetSec > 0) {
    const chars = cnLen(clean)
    const needed = chars / (4.6 * (targetSec - 0.25)) // 预留 0.25s 尾部呼吸
    if (needed > rate) {
      rate = Math.min(1.35, Math.max(rate, needed))
      if (needed > 1.35) overflow = true
    }
  }

  const token = await getAccessToken()
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      input: { text: clean },
      voice: preset.voice,
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: Number(rate.toFixed(2)),
        pitch: preset.pitch,
        sampleRateHertz: 44100,
      },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Cloud TTS ${res.status}: ${body.slice(0, 300)}`)
  }

  const data = await res.json()
  if (!data.audioContent) throw new Error('Cloud TTS 未返回音频')

  const file = `${baseName}.mp3`
  const abs = path.join(MEDIA_DIR, file)
  await fsp.writeFile(abs, Buffer.from(data.audioContent, 'base64'))

  return {
    file: abs,
    url: `/media/${file}`,
    rate: Number(rate.toFixed(2)),
    voicePreset: voicePreset || DEFAULT_VOICE,
    voiceName: preset.name,
    chars: cnLen(clean),
    estimatedSec: Number((cnLen(clean) / (4.6 * rate)).toFixed(2)),
    overflow,
  }
}

export function ttsAvailable() {
  return config.vertex.enabled
}
