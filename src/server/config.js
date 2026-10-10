import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const ROOT = path.resolve(__dirname, '../..')
export const DATA_DIR = path.join(ROOT, 'data', 'runtime')
export const SEED_DIR = path.join(ROOT, 'data', 'seed')
export const BUSINESS_DIR = path.join(ROOT, 'config', 'business')
export const MEDIA_DIR = path.join(DATA_DIR, 'media')
export const DIST_DIR = path.join(ROOT, 'dist')

// Resolve .env from the application root, regardless of the launch directory.
dotenv.config({ path: path.join(ROOT, '.env') })
const env = process.env

export const config = {
  port: Number(env.PORT || 8787),

  /** Google Vertex AI（服务账号认证）——可用时优先于 OpenAI 兼容后端 */
  vertex: {
    location: env.VERTEX_LOCATION || 'us-central1',
    geminiModel: env.VERTEX_GEMINI_MODEL || '',
    imageModel: env.VERTEX_IMAGE_MODEL || '',
    veoModel: env.VERTEX_VEO_MODEL || '',
    enabled: false, // 启动时按凭证探测结果回填
  },

  llm: {
    baseUrl: (env.LLM_BASE_URL || '').replace(/\/$/, ''),
    apiKey: env.LLM_API_KEY || '',
    model: env.LLM_MODEL || '',
    timeout: Number(env.LLM_TIMEOUT_MS || 180000),
    get enabled() {
      return Boolean(this.baseUrl && this.apiKey && this.model)
    },
  },

  image: {
    baseUrl: (env.IMAGE_BASE_URL || '').replace(/\/$/, ''),
    apiKey: env.IMAGE_API_KEY || '',
    model: env.IMAGE_MODEL || '',
    size: env.IMAGE_SIZE || '1024x1536',
    get enabled() {
      return Boolean(this.baseUrl && this.apiKey && this.model)
    },
  },

  video: {
    /** vertex | http | mock | manual；留空时自动选择 */
    mode: env.VIDEO_MODE || '',
    apiUrl: env.VIDEO_API_URL || '',
    apiKey: env.VIDEO_API_KEY || '',
    statusUrl: env.VIDEO_STATUS_URL || '',
    model: env.VIDEO_MODEL || '',
    /** 是否让 Veo 生成环境音（人声口播由 Cloud TTS 单独合成） */
    generateAudio: env.VIDEO_GENERATE_AUDIO !== 'false',
  },

  /** 口播配音（Google Cloud Text-to-Speech，复用 GCP 服务账号） */
  tts: {
    enabled: env.TTS_ENABLED !== 'false',
    defaultVoice: env.TTS_VOICE || 'relatable-female',
    /** 有口播时环境音压低到该音量，保证人声清晰 */
    ambientVolume: Number(env.TTS_AMBIENT_VOLUME || 0.3),
    voVolume: Number(env.TTS_VO_VOLUME || 1.1),
  },

  ffmpegPath: env.FFMPEG_PATH || 'ffmpeg',
  subtitleFont: env.SUBTITLE_FONT || '',
}

/** 实际生效的视频后端 */
export function resolvedVideoMode() {
  const m = config.video.mode
  if (m) return m
  if (config.vertex.enabled) return 'vertex'
  if (config.video.apiUrl) return 'http'
  return 'mock'
}

export function providerStatus() {
  const v = config.vertex
  const mode = resolvedVideoMode()
  return {
    llm: v.enabled ? `vertex (${v.geminiModel})` : config.llm.enabled ? `live (${config.llm.model})` : 'mock',
    image: v.enabled ? `vertex (${v.imageModel})` : config.image.enabled ? `live (${config.image.model})` : 'mock',
    video:
      mode === 'vertex'
        ? `vertex (${config.video.model || v.veoModel})`
        : mode === 'http' && config.video.apiUrl
          ? `live (${config.video.model || 'custom'})`
          : mode === 'manual'
            ? 'manual'
            : 'mock',
    tts: v.enabled && config.tts.enabled ? 'cloud-tts (cmn-CN)' : 'off',
  }
}
