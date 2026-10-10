import { config } from '../config.js'
import { geminiChat } from './vertex.js'

export function extractJson(text) {
  if (!text) throw new Error('LLM 返回内容为空')
  let s = String(text).trim()
  // 去掉 markdown 代码围栏
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const start = s.search(/[{[]/)
  if (start < 0) throw new Error('LLM 返回内容中未找到 JSON')
  const openChar = s[start]
  const closeChar = openChar === '{' ? '}' : ']'
  const end = s.lastIndexOf(closeChar)
  if (end <= start) throw new Error('LLM 返回的 JSON 不完整')
  return JSON.parse(s.slice(start, end + 1))
}

async function chat(messages) {
  const { baseUrl, apiKey, model, timeout } = config.llm
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.85,
        response_format: { type: 'json_object' },
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`LLM ${res.status}: ${body.slice(0, 400)}`)
    }
    const data = await res.json()
    return data?.choices?.[0]?.message?.content || ''
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 调用 LLM 并解析 JSON；未配置任何后端或调用失败时回退到 mock 生成器，
 * 保证工作流在任何环境下都能完整跑通。
 * 优先级：Vertex AI (Gemini) > OpenAI 兼容 > Mock
 */
export async function llmJson(messages, mockFactory) {
  const useVertex = config.vertex.enabled
  const useOpenai = config.llm.enabled
  if (!useVertex && !useOpenai) {
    return { data: mockFactory(), source: 'mock' }
  }
  try {
    const raw = useVertex ? await geminiChat(messages) : await chat(messages)
    return { data: extractJson(raw), source: useVertex ? 'gemini' : 'llm' }
  } catch (err) {
    console.error('[llm] 调用失败，回退 mock:', err.message)
    return { data: mockFactory(), source: 'mock-fallback', error: err.message }
  }
}
