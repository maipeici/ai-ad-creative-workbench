import { execFile } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { config, MEDIA_DIR } from '../config.js'

function run(args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(config.ffmpegPath, args, { windowsHide: true, maxBuffer: 1024 * 1024 * 32, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve(stdout)
    })
  })
}

let ffmpegAvailable = null
export async function hasFfmpeg() {
  if (ffmpegAvailable !== null) return ffmpegAvailable
  try {
    await run(['-version'])
    ffmpegAvailable = true
  } catch {
    ffmpegAvailable = false
  }
  return ffmpegAvailable
}

/** 探测可用的中文字体，字幕烧录需要 */
let fontCache = null
export function findChineseFont() {
  if (fontCache !== null) return fontCache
  const candidates = [
    config.subtitleFont,
    'C:/Windows/Fonts/msyh.ttc',
    'C:/Windows/Fonts/msyhbd.ttc',
    'C:/Windows/Fonts/simhei.ttf',
    'C:/Windows/Fonts/simsun.ttc',
    '/System/Library/Fonts/PingFang.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
  ].filter(Boolean)
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      fontCache = c
      return fontCache
    }
  }
  fontCache = ''
  return fontCache
}

const PALETTE = ['0x2b3a4a', '0x3a4a5a', '0x4a3a3a', '0x3a4a3a', '0x4a4a3a', '0x3a3a4a']

/** Mock 视频：纯色占位片段，用于验证时长、顺序与合成链路 */
export async function makeMockClip({ outFile, seconds, index = 0 }) {
  const color = PALETTE[index % PALETTE.length]
  await run([
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=${color}:s=1080x1920:r=30:d=${Math.max(1, seconds)}`,
    '-f', 'lavfi',
    '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-shortest',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    outFile,
  ])
  return outFile
}

/** ffmpeg drawtext 值转义 */
function escapeDrawtext(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
}

function escapePath(p) {
  return String(p).replace(/\\/g, '/').replace(/:/g, '\\:')
}

/** 十六进制色转 ffmpeg 颜色写法 */
function toFfColor(hex, fallback = 'white') {
  const m = String(hex || '').match(/^#?([0-9a-fA-F]{6})$/)
  return m ? `0x${m[1]}` : fallback
}

/**
 * 为单个镜头叠加字幕、图片素材与口播配音。
 * 这是保证优惠金额、界面、Logo 100% 准确的关键：文字与界面绝不经过视频模型。
 *
 * @param {object} opts
 *   inFile         源视频
 *   outFile        输出视频
 *   subtitle       中文字幕文本（\n 可分两行）
 *   images         [{ file, position, widthRatio, opacity }]
 *                  position: top | center | bottom | bottom-left | top-right ...
 *   voFile         口播音频文件（TTS 产物），会与原音轨混音
 *   voVolume       口播音量（默认 1.0）
 *   ambientVolume  原始环境音音量（有口播时自动压低）
 *   logoFile       品牌角标文件，全程右上角小尺寸展示
 *   brandColor     品牌色，用于字幕描边与字幕底衬
 *   safeArea       { top, bottom, left, right } 安全区比例
 *   durationSec    镜头时长，用于音频对齐
 */
export async function applyOverlay({
  inFile,
  outFile,
  subtitle,
  images = [],
  voFile,
  voVolume = 1.0,
  ambientVolume = 0.35,
  logoFile,
  brandColor = '#FF3E7F',
  safeArea = { top: 0.12, bottom: 0.22 },
  durationSec,
  screenFit = null,
}) {
  const font = findChineseFont()
  const safeBottom = safeArea?.bottom ?? 0.22
  const inputs = ['-y', '-i', inFile]
  const filters = []
  let audioIdx = null
  let inputCount = 1

  // 先把源画面统一到 1080x1920，否则下面所有像素坐标都会错位
  // （Veo 输出常见 720x1280，直接按 1080 坐标叠加会把字幕推出画面）
  filters.push(
    `[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,` +
      `pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[base]`,
  )
  let lastLabel = 'base'

  // 画布基准尺寸：叠加位置按 1080x1920 计算，最终 concat 阶段统一缩放
  const CW = 1080
  const CH = 1920
  const safeLeft = Math.round(CW * (safeArea?.left ?? 0.06))
  const safeRight = Math.round(CW * (1 - (safeArea?.right ?? 0.08)))
  const safeWidth = Math.max(1, safeRight - safeLeft)
  const topPad = Math.round(CH * ((safeArea?.top ?? 0.12) + 0.03))
  const subtitleTopPx = Math.round(CH * (1 - safeBottom - 0.015))

  // 先算字幕块占位，图片叠加要避开它，否则 Logo/优惠卡会压住字幕
  const subtitleLines = subtitle && font ? String(subtitle).split(/[\n\r]+/).filter(Boolean).slice(0, 2) : []
  const SUB_LINE_H = 84
  const subBlockH = subtitleLines.length * SUB_LINE_H
  const subBoxY = subtitleTopPx - subBlockH
  // 图片可用区域的下边界：字幕框上方留 28px 间隙
  const contentBottomPx = subtitleLines.length ? subBoxY - 28 : subtitleTopPx

  // 1) 内容图片叠加（App 界面 / 优惠卡）
  //    同时约束宽和高：长截图按宽度缩放会占满整屏遮住画面
  const usableImages = images.filter((img) => img?.file && fs.existsSync(img.file))
  const maxImgH = Math.round((contentBottomPx - topPad) * 0.86)

  usableImages.forEach((img, i) => {
    inputs.push('-i', img.file)
    const inIdx = inputCount++
    const w = Math.min(safeWidth, Math.round(CW * (img.widthRatio || 0.3)))
    const scaled = `ov${i}`
    // force_original_aspect_ratio=decrease 保证同时不超过 w 与 maxImgH
    filters.push(
      `[${inIdx}:v]scale=${w}:${maxImgH}:force_original_aspect_ratio=decrease` +
        `${img.opacity != null && img.opacity < 1 ? `,format=rgba,colorchannelmixer=aa=${img.opacity}` : ''}[${scaled}]`,
    )

    let x = `${safeLeft}+(${safeWidth}-w)/2`
    let y = `${topPad}+((${contentBottomPx}-${topPad}-h)/2)`
    const pos = img.position || 'center'
    if (pos.includes('top')) y = `${topPad}`
    if (pos.includes('bottom')) y = `${contentBottomPx}-h`
    if (pos.includes('left')) x = `${safeLeft}`
    if (pos.includes('right')) x = `${safeRight}-w`

    const out = `bg${i}`
    filters.push(`[${lastLabel}][${scaled}]overlay=${x}:${y}[${out}]`)
    lastLabel = out
  })

  // 1.5) 绿幕屏幕合成：把 AI 渲染的绿色手机屏换成真实 App 界面
  //      AI 模型几乎不可能画出可用的关机屏，但一定会画纯绿占位屏，
  //      所以直接用真实截图替换绿区，手机就真的在显示 App。
  if (screenFit?.file && fs.existsSync(screenFit.file) && screenFit.box) {
    const bx = Math.round(CW * screenFit.box.x)
    const by = Math.round(CH * screenFit.box.y)
    const bw = Math.round(CW * screenFit.box.w)
    const bh = Math.round(CH * screenFit.box.h)

    // 先把绿区填成关机深色（略扩边，盖住绿边）
    filters.push(
      `[${lastLabel}]drawbox=x=${bx}:y=${by}:w=${bw}:h=${bh}:color=0x14171c@1:t=fill[scrbg]`,
    )
    lastLabel = 'scrbg'

    inputs.push('-i', screenFit.file)
    const uiIdx = inputCount++
    // 等比缩放放入屏幕区域，避免界面被拉伸变形
    filters.push(`[${uiIdx}:v]scale=${bw}:${bh}:force_original_aspect_ratio=decrease[ui]`)
    filters.push(`[${lastLabel}][ui]overlay=${bx}+((${bw}-w)/2):${by}+((${bh}-h)/2)[scrui]`)
    lastLabel = 'scrui'
  }

  // 2) 品牌角标（右上角常驻，强化品牌识别但不抢画面）
  if (logoFile && fs.existsSync(logoFile)) {
    inputs.push('-i', logoFile)
    const inIdx = inputCount++
    filters.push(
      `[${inIdx}:v]scale=${Math.round(CW * 0.19)}:-1,format=rgba,colorchannelmixer=aa=0.82[wm]`,
    )
    filters.push(
      `[${lastLabel}][wm]overlay=${safeRight}-w:${Math.round(CH * ((safeArea?.top ?? 0.12) + 0.01))}[wmout]`,
    )
    lastLabel = 'wmout'
  }

  // 3) 字幕：深色底衬 + 品牌色描边白字，竖屏可读性优先
  if (subtitleLines.length) {
    // drawbox 只认 iw/ih，不能用 W/H，这里直接用像素值
    filters.push(`[${lastLabel}]drawbox=x=${safeLeft}:y=${subBoxY}:w=${safeWidth}:h=${subBlockH + 16}:color=black@0.42:t=fill[subbg]`)
    lastLabel = 'subbg'

    subtitleLines.forEach((line, i) => {
      const yExpr = subBoxY + i * SUB_LINE_H + 10
      const out = `sub${i}`
      const fontSize = Math.min(58, Math.max(12, Math.floor((safeWidth - 24) / Math.max(1, [...line].length))))
      filters.push(
        `[${lastLabel}]drawtext=fontfile='${escapePath(font)}':text='${escapeDrawtext(line)}'` +
          `:fontsize=${fontSize}:fontcolor=white:borderw=5:bordercolor=${toFfColor(brandColor)}@0.9` +
          `:shadowx=0:shadowy=3:shadowcolor=black@0.5` +
          `:x=${safeLeft}+(${safeWidth}-text_w)/2:y=${yExpr}[${out}]`,
      )
      lastLabel = out
    })
  }

  // 是否有真实叠加内容（base 缩放不算）
  const hasVisualOverlay =
    usableImages.length > 0 ||
    Boolean(logoFile && fs.existsSync(logoFile)) ||
    Boolean(subtitle && font) ||
    Boolean(screenFit?.file && fs.existsSync(screenFit.file) && screenFit.box)

  // 4) 音频：口播 TTS 与环境音混合
  const hasVo = voFile && fs.existsSync(voFile)
  if (hasVo) {
    inputs.push('-i', voFile)
    audioIdx = inputCount++
  }

  if (!hasVisualOverlay && !hasVo && !durationSec) {
    await fsp.copyFile(inFile, outFile)
    return {
      outFile,
      applied: false,
      reason: subtitle && !font ? '未找到中文字体，字幕未烧录' : '无需叠加',
    }
  }

  // 探测源视频是否有音轨，决定混音策略
  const srcHasAudio = await hasAudioStream(inFile)
  const finalAudioFilters = []
  let mapAudio = []
  if (hasVo) {
    if (srcHasAudio) {
      // 环境音压低 + 口播，amix 后做一次限幅避免削波
      finalAudioFilters.push(
        `[${audioIdx}:a]volume=${voVolume},aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[voa]`,
        `[0:a]volume=${ambientVolume},aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[amb]`,
        `[amb][voa]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]`,
      )
      mapAudio = ['-map', '[aout]']
    } else {
      // 无环境音时直接用口播
      finalAudioFilters.push(
        `[${audioIdx}:a]volume=${voVolume},aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[aout]`,
      )
      mapAudio = ['-map', '[aout]']
    }
  } else if (srcHasAudio) {
    mapAudio = ['-map', '0:a']
  }

  const allFilters = [...filters, ...finalAudioFilters].join(';')

  const args = [
    ...inputs,
    ...(allFilters ? ['-filter_complex', allFilters] : []),
    '-map', filters.length ? `[${lastLabel}]` : '0:v',
    ...mapAudio,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-r', '30',
  ]
  if (mapAudio.length) args.push('-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2')
  else args.push('-an')
  if (durationSec) args.push('-t', String(durationSec))
  args.push(outFile)

  await run(args)
  return {
    outFile,
    applied: true,
    font: font || null,
    images: usableImages.length,
    logo: Boolean(logoFile && fs.existsSync(logoFile)),
    screenFit: Boolean(screenFit?.file && screenFit.box),
    vo: hasVo,
    subtitle: Boolean(subtitle && font),
  }
}

/**
 * 检测视频中的绿幕手机屏（模型常把「待后期替换的屏幕」渲染成纯绿）。
 * 采样多个时间点：手机往往在中途才举到画面里，只看第 0 帧会漏检。
 * 返回覆盖率最高一帧的绿幕包围盒（画面比例），供 screenFit 精确合成使用。
 */
export async function detectGreenScreen(file) {
  const SW = 270
  const SH = 480

  // 取时长，按 10% / 45% / 80% 采样
  const duration = await new Promise((resolve) => {
    execFile(
      config.ffmpegPath,
      ['-hide_banner', '-i', file],
      { windowsHide: true, maxBuffer: 1024 * 1024 * 8 },
      (_err, _stdout, stderr) => {
        const m = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/.exec(String(stderr || ''))
        resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0)
      },
    )
  })
  const marks = duration > 0 ? [0.1, 0.45, 0.8].map((f) => Math.min(duration * f, Math.max(0, duration - 0.1))) : [0]

  let best = null
  for (const at of marks) {
    const buf = await new Promise((resolve, reject) => {
      execFile(
        config.ffmpegPath,
        ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', `scale=${SW}:${SH}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
        { windowsHide: true, maxBuffer: 1024 * 1024 * 8, encoding: 'buffer' },
        (err, stdout) => (err ? reject(err) : resolve(stdout)),
      ).on('error', () => resolve(Buffer.alloc(0)))
    })
    if (!buf || buf.length < SW * SH * 3) continue

    let minX = SW, minY = SH, maxX = -1, maxY = -1, greenCount = 0
    for (let y = 0; y < SH; y++) {
      for (let x = 0; x < SW; x++) {
        const i = (y * SW + x) * 3
        const r = buf[i], g = buf[i + 1], b = buf[i + 2]
        // 纯绿/荧光绿判定：绿通道显著高于红蓝
        if (g > 110 && g > r * 1.5 && g > b * 1.5) {
          greenCount++
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
        }
      }
    }

    const coverage = greenCount / (SW * SH)
    if (maxX < 0 || coverage < 0.01) continue
    const box = {
      x: minX / SW,
      y: minY / SH,
      w: (maxX - minX + 1) / SW,
      h: (maxY - minY + 1) / SH,
    }
    // 过小的绿块（反光、道具）不算屏幕
    if (box.w < 0.08 || box.h < 0.08) continue
    if (!best || coverage > best.coverage) best = { found: true, box, coverage: Number(coverage.toFixed(3)), at }
  }

  return best || { found: false }
}

/**
 * 探测文件是否含音频流。
 * 不依赖 ffprobe（很多 ffmpeg 分发包或 PATH 里没有它），
 * 直接用 ffmpeg 读取容器信息，从 stderr 的流描述里判断。
 */
const audioProbeCache = new Map()
export async function hasAudioStream(file) {
  if (audioProbeCache.has(file)) return audioProbeCache.get(file)

  const detect = await new Promise((resolve) => {
    execFile(
      config.ffmpegPath,
      ['-hide_banner', '-i', file],
      { windowsHide: true, maxBuffer: 1024 * 1024 * 8 },
      (_err, _stdout, stderr) => {
        // 没有输出文件参数时 ffmpeg 必然以非 0 退出，流信息在 stderr 里
        resolve(/Stream #\d+:\d+.*: Audio:/i.test(String(stderr || '')))
      },
    )
  })

  audioProbeCache.set(file, detect)
  return detect
}

/**
 * 将多个镜头视频按顺序合成为成片。
 *
 * 用 concat filter 而非 concat demuxer：
 * demuxer 要求所有输入流结构完全一致，一旦某镜头无音轨就会丢音或报错。
 * filter 方式对每个输入显式补齐音轨（无音轨则注入静音），保证配音不丢。
 */
export async function concatClips({ files, outFile }) {
  // 两段式：先把每个镜头规范化为「1080x1920 / 30fps / 立体声」，再无损 concat。
  // 无音轨的镜头会被注入静音轨，避免 concat 因流数不一致丢音。
  const normalized = []
  try {
    for (let i = 0; i < files.length; i++) {
      const out = path.join(MEDIA_DIR, `norm-${Date.now()}-${i}.mp4`)
      const withAudio = await hasAudioStream(files[i])
      const args = ['-y', '-i', files[i]]
      if (!withAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100')
      args.push(
        '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1',
        '-r', '30',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '20',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-ac', '2',
      )
      if (!withAudio) args.push('-shortest')
      args.push(out)
      await run(args)
      normalized.push(out)
    }

    const listFile = path.join(MEDIA_DIR, `concat-${Date.now()}.txt`)
    await fsp.writeFile(
      listFile,
      normalized.map((f) => `file '${path.basename(f).replace(/'/g, "'\\''")}'`).join('\n'),
      'utf8',
    )
    try {
      await run(
        [
          '-y',
          '-f', 'concat',
          '-safe', '0',
          '-i', path.basename(listFile),
          '-c', 'copy',
          path.basename(outFile),
        ],
        { cwd: MEDIA_DIR },
      )
    } finally {
      await fsp.unlink(listFile).catch(() => {})
    }
  } finally {
    for (const f of normalized) await fsp.unlink(f).catch(() => {})
  }

  return outFile
}

/** 抽取首帧作为封面（信息流素材封面直接影响 CTR） */
export async function extractCover({ inFile, outFile, atSec = 0.1 }) {
  await run(['-y', '-ss', String(atSec), '-i', inFile, '-frames:v', '1', '-q:v', '2', outFile])
  return outFile
}

/** 无 ffmpeg 时导出可手动执行的合成命令 */
export function buildManualConcatCommand(files, outName) {
  const list = files.map((f) => `file '${path.basename(f)}'`).join('\n')
  return {
    listFileContent: list,
    command: `ffmpeg -y -f concat -safe 0 -i shots.txt -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a aac ${outName}`,
  }
}
