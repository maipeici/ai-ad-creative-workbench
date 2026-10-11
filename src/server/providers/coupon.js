import fsp from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { MEDIA_DIR } from '../config.js'
import { usableFact } from '../workspace.js'

/**
 * 优惠卡片 / CTA 卡片生成器
 * ---------------------------------------------------------------
 * 为什么需要它：
 *   优惠素材绝对不能从网络抓取（第三方导流站的金额互相矛盾且多为过期信息），
 *   也绝对不能交给 AI 绘制（会编造金额、中文出错）。
 *
 * 本模块用官方品牌色 + 官方 Logo + 固定版式，把「已确认事实」里的真实金额
 * 渲染成标准优惠卡。金额、门槛、有效期全部来自 product-facts.json 中
 * status=confirmed 的条目，函数拒绝渲染任何未确认或含占位符的数据。
 */

function escapeXml(s) {
  return String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c])
}

const PLACEHOLDER = /待补充|待确认|\[.*?\]/

/** 校验事实是否可用于渲染 */
export function assertRenderable(fact, fields = []) {
  if (!fact) throw new Error('未提供事实条目')
  if (!usableFact(fact)) {
    throw new Error(`事实「${fact.title}」未确认、不在有效期内或日期不完整，不可用于生成优惠卡。请先在品牌素材补齐并确认。`)
  }
  for (const f of fields) {
    const v = fact[f]
    if (!v || PLACEHOLDER.test(String(v))) {
      throw new Error(`事实「${fact.title}」的字段 ${f} 仍为占位值（${v || '空'}），无法生成优惠卡。`)
    }
  }
  return true
}

/**
 * 生成优惠卡 SVG。
 * 所有文案由调用方从 confirmed 事实中取出，本函数不做任何推断或补全。
 */
export function couponSvg({
  headline,
  amount,
  amountUnit = '元',
  threshold,
  validity,
  cities,
  footnote,
  brandColor = '#FF3E7F',
  gradientTo = '#9B4DFF',
  width = 860,
  height = 520,
}) {
  const hasAmount = amount !== undefined && amount !== null && String(amount).trim() !== ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${brandColor}"/>
      <stop offset="100%" stop-color="${gradientTo}"/>
    </linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="12" flood-color="#000" flood-opacity="0.28"/>
    </filter>
  </defs>

  <rect x="16" y="16" width="${width - 32}" height="${height - 32}" rx="36" fill="url(#bg)" filter="url(#sh)"/>
  <rect x="34" y="34" width="${width - 68}" height="${height - 68}" rx="26" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-dasharray="14 10" stroke-width="2.5"/>

  <text x="${width / 2}" y="118" text-anchor="middle" fill="#ffffff" font-size="40" font-weight="700"
        font-family="Microsoft YaHei, PingFang SC, sans-serif">${escapeXml(headline || '')}</text>

  ${
    hasAmount
      ? `<text x="${width / 2}" y="288" text-anchor="middle" fill="#ffffff" font-size="170" font-weight="800"
        font-family="Microsoft YaHei, PingFang SC, sans-serif">${escapeXml(amount)}<tspan font-size="62" font-weight="700" dx="8">${escapeXml(amountUnit)}</tspan></text>`
      : ''
  }

  ${
    threshold
      ? `<rect x="${width / 2 - 190}" y="${hasAmount ? 322 : 200}" width="380" height="54" rx="27" fill="#ffffff" fill-opacity="0.22"/>
  <text x="${width / 2}" y="${hasAmount ? 358 : 236}" text-anchor="middle" fill="#ffffff" font-size="28" font-weight="600"
        font-family="Microsoft YaHei, PingFang SC, sans-serif">${escapeXml(threshold)}</text>`
      : ''
  }

  ${
    validity
      ? `<text x="${width / 2}" y="${height - 96}" text-anchor="middle" fill="#ffffff" fill-opacity="0.92" font-size="24"
        font-family="Microsoft YaHei, PingFang SC, sans-serif">有效期：${escapeXml(validity)}</text>`
      : ''
  }
  ${
    cities
      ? `<text x="${width / 2}" y="${height - 64}" text-anchor="middle" fill="#ffffff" fill-opacity="0.85" font-size="22"
        font-family="Microsoft YaHei, PingFang SC, sans-serif">适用城市：${escapeXml(cities)}</text>`
      : ''
  }
  ${
    footnote
      ? `<text x="${width / 2}" y="${height - 34}" text-anchor="middle" fill="#ffffff" fill-opacity="0.75" font-size="19"
        font-family="Microsoft YaHei, PingFang SC, sans-serif">${escapeXml(footnote)}</text>`
      : ''
  }
</svg>`
}

/** CTA 按钮卡片 */
export function ctaSvg({ text, brandColor = '#FF3E7F', gradientTo = '#9B4DFF', width = 760, height = 150 }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${brandColor}"/>
      <stop offset="100%" stop-color="${gradientTo}"/>
    </linearGradient>
    <filter id="s"><feDropShadow dx="0" dy="5" stdDeviation="9" flood-color="#000" flood-opacity="0.3"/></filter>
  </defs>
  <rect x="10" y="10" width="${width - 20}" height="${height - 20}" rx="${(height - 20) / 2}" fill="url(#g)" filter="url(#s)"/>
  <text x="${width / 2}" y="${height / 2 + 16}" text-anchor="middle" fill="#ffffff" font-size="46" font-weight="700"
        font-family="Microsoft YaHei, PingFang SC, sans-serif">${escapeXml(text || '')}</text>
</svg>`
}

/**
 * 把 SVG 渲染为透明底 PNG 落盘。
 * 用 sharp（内置 librsvg）渲染，中文字体走系统字体，输出可直接给 ffmpeg 叠加。
 */
export async function saveCard({ svg, baseName }) {
  const pngFile = `${baseName}.png`
  const buf = await sharp(Buffer.from(svg)).png().toBuffer()
  await fsp.writeFile(path.join(MEDIA_DIR, pngFile), buf)
  return { png: `/media/${pngFile}`, bytes: buf.length }
}

/**
 * 从已确认事实生成优惠卡。
 * 这是唯一允许产出含金额素材的路径：数据来源被强制限定为 confirmed 事实。
 */
export async function buildCouponFromFact({ fact, brandGuide, headline, baseName }) {
  assertRenderable(fact, ['couponAmount'])

  const bi = brandGuide?.brandIdentity || {}
  const amountRaw = String(fact.couponAmount).trim()
  const numMatch = amountRaw.match(/^(\d+(?:\.\d+)?)\s*(.*)$/)

  const svg = couponSvg({
    headline: headline || fact.title,
    amount: numMatch ? numMatch[1] : amountRaw,
    amountUnit: numMatch ? numMatch[2] || '元' : '',
    threshold: fact.threshold && !PLACEHOLDER.test(fact.threshold) ? fact.threshold : '',
    validity:
      fact.validFrom && fact.validTo && !PLACEHOLDER.test(`${fact.validFrom}${fact.validTo}`)
        ? `${fact.validFrom} 至 ${fact.validTo}`
        : '',
    cities: fact.cities && !PLACEHOLDER.test(fact.cities) ? fact.cities : '',
    footnote: (fact.conditions || []).filter((c) => !PLACEHOLDER.test(c)).join('　') || '',
    brandColor: bi.primaryColor || '#FF3E7F',
    gradientTo: bi.gradient?.[1] || '#9B4DFF',
  })

  const saved = await saveCard({ svg, baseName })
  return { ...saved, factId: fact.id, source: fact.source }
}

/**
 * 品牌结尾卡：Logo + 品牌色渐变 + CTA 文案。
 * 用于结尾镜头整屏叠加，显著强化品牌识别。
 */
export function endCardSvg({
  logoDataUri,
  ctaText,
  slogan = '实惠出行新选择',
  brandColor = '#FF3E7F',
  gradientTo = '#9B4DFF',
  width = 1080,
  height = 1920,
}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0%" stop-color="${brandColor}"/>
      <stop offset="100%" stop-color="${gradientTo}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  ${
    logoDataUri
      ? `<image x="${width * 0.14}" y="${height * 0.36}" width="${width * 0.72}" href="${logoDataUri}" preserveAspectRatio="xMidYMid meet"/>`
      : `<text x="${width / 2}" y="${height * 0.44}" text-anchor="middle" fill="#ffffff" font-size="110" font-weight="800"
             font-family="Microsoft YaHei, PingFang SC, sans-serif">花小猪打车</text>`
  }
  <text x="${width / 2}" y="${height * 0.535}" text-anchor="middle" fill="#ffffff" fill-opacity="0.95" font-size="52"
        font-family="Microsoft YaHei, PingFang SC, sans-serif">${escapeXml(slogan)}</text>
  ${
    ctaText
      ? `<rect x="${width * 0.16}" y="${height * 0.60}" width="${width * 0.68}" height="130" rx="65" fill="#ffffff"/>
  <text x="${width / 2}" y="${height * 0.60 + 86}" text-anchor="middle" fill="${brandColor}" font-size="54" font-weight="700"
        font-family="Microsoft YaHei, PingFang SC, sans-serif">${escapeXml(ctaText)}</text>`
      : ''
  }
</svg>`
}

export async function buildEndCard({ brandGuide, ctaText, logoFile, baseName }) {
  const bi = brandGuide?.brandIdentity || {}
  let logoDataUri = null
  if (logoFile) {
    try {
      const buf = await fsp.readFile(logoFile)
      const ext = path.extname(logoFile).toLowerCase()
      const mime = ext === '.svg' ? 'image/svg+xml' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
      logoDataUri = `data:${mime};base64,${buf.toString('base64')}`
    } catch {
      /* 无 Logo 时用文字兜底 */
    }
  }
  const svg = endCardSvg({
    logoDataUri,
    ctaText,
    slogan: bi.positioning?.slice(0, 12) || '实惠出行新选择',
    brandColor: bi.primaryColor || '#FF3E7F',
    gradientTo: bi.gradient?.[1] || '#9B4DFF',
  })
  return saveCard({ svg, baseName })
}

export async function buildCtaCard({ text, brandGuide, baseName }) {
  const bi = brandGuide?.brandIdentity || {}
  const svg = ctaSvg({
    text,
    brandColor: bi.primaryColor || '#FF3E7F',
    gradientTo: bi.gradient?.[1] || '#9B4DFF',
  })
  return saveCard({ svg, baseName })
}
