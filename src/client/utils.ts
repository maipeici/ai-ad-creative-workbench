/** 统计中文/字母/数字字符数，与服务端 countCn 保持一致 */
export function countCnClient(text?: string): number {
  return (String(text || '').match(/[\u4e00-\u9fa5a-zA-Z0-9]/g) || []).length
}

/** 生成可回溯的投放素材文件名：便于投放数据归因 */
export function buildMaterialName(parts: {
  audience?: string
  scene?: string
  variable?: string
  version?: string | number
}): string {
  const seg = ['hxz', parts.audience, parts.scene, parts.variable, `v${parts.version ?? 1}`]
    .filter(Boolean)
    .map((s) => String(s).replace(/[^\w\u4e00-\u9fa5-]/g, ''))
  return seg.join('_')
}
