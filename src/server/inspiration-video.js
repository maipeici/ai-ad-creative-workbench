import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import multer from 'multer'
import { MEDIA_DIR, config } from './config.js'

// Stay below the provider's 20 MB request limit after base64 encoding.
export const MAX_REFERENCE_VIDEO_BYTES = 14 * 1024 * 1024
const failure = (message, status = 400) => Object.assign(new Error(message), { status })
export function videoMime(bytes) {
  if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp') {
    return bytes.toString('ascii', 8, 12).startsWith('qt') ? 'video/quicktime' : 'video/mp4'
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'video/webm'
  throw failure('请选择有效的 MP4、MOV 或 WebM 视频文件。')
}
export function createVideoUpload(directory = MEDIA_DIR) {
  const middleware = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_REFERENCE_VIDEO_BYTES, files: 1 } }).single('file')
  return async (req, res) => {
    await new Promise((resolve, reject) => middleware(req, res, e => e ? reject(failure(e.code === 'LIMIT_FILE_SIZE' ? '参考视频不能超过 14 MB，请先压缩后上传。' : '视频上传失败，请重新选择文件。')) : resolve()))
    if (!req.file?.buffer?.length) throw failure('请先选择视频文件。')
    const bytes = req.file.buffer, mimeType = videoMime(bytes)
    const file = `reference-${randomUUID()}.${mimeType === 'video/mp4' ? 'mp4' : mimeType === 'video/webm' ? 'webm' : 'mov'}`
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, file), bytes, { flag: 'wx' })
    return { url: `/media/${file}`, name: path.basename(req.file.originalname).slice(0, 160), mimeType, size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), uploadedAt: new Date().toISOString() }
  }
}
export async function readReferenceVideo(video, directory = MEDIA_DIR) {
  if (!/^\/media\/reference-[a-f0-9-]+\.(mp4|webm|mov)$/.test(video?.url || '')) throw failure('参考视频路径无效，请重新上传。')
  let bytes
  try { bytes = await fs.readFile(path.join(directory, path.basename(video.url))) }
  catch { throw failure('参考视频文件不存在，请重新上传。', 404) }
  if (!bytes.length || bytes.length > MAX_REFERENCE_VIDEO_BYTES) throw failure('参考视频为空或超过 14 MB。')
  if (createHash('sha256').update(bytes).digest('hex') !== video.sha256) throw failure('参考视频文件已变化，请重新上传并拆解。', 409)
  return { inlineData: { mimeType: videoMime(bytes), data: bytes.toString('base64') } }
}
export function requireVideoModel() {
  if (!config.vertex.enabled) throw failure('直接分析视频需要配置支持视频理解的 Vertex Gemini 模型；也可填写脚本进行文本拆解。', 503)
}
