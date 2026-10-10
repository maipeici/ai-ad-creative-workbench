import crypto from 'node:crypto'
import '../config.js'

/**
 * GCP Service Account 认证
 * -------------------------------------------------------------
 * 用 RS256 自签 JWT 换取 OAuth2 access token（Node 内置 crypto，无需额外依赖）。
 * Token 有效期 1 小时，这里缓存并提前 5 分钟刷新。
 */

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform'

let credentials = null
let cache = { token: null, expiresAt: 0 }

/** Parse server-only environment variables; never load credential JSON files. */
export function credentialsFromEnv(env) {
  const names = ['GCP_PROJECT_ID', 'GCP_CLIENT_EMAIL', 'GCP_PRIVATE_KEY']
  if (!names.some(name => Boolean(env[name]))) return null
  const missing = names.filter(name => !env[name])
  if (missing.length) throw new Error('Missing environment variables: ' + missing.join(', '))

  const privateKey = env.GCP_PRIVATE_KEY.replace(/\\n/g, '\n')
  try {
    const key = crypto.createPrivateKey(privateKey)
    if (key.asymmetricKeyType !== 'rsa') throw new Error('Unsupported key type')
  } catch {
    throw new Error('Invalid GCP_PRIVATE_KEY: expected an RSA private key')
  }
  return {
    project_id: env.GCP_PROJECT_ID,
    client_email: env.GCP_CLIENT_EMAIL,
    private_key: privateKey,
    token_uri: env.GCP_TOKEN_URI || 'https://oauth2.googleapis.com/token',
  }
}

export function loadCredentials() {
  if (credentials) return credentials
  credentials = credentialsFromEnv(process.env)
  return credentials
}
export function hasCredentials() {
  try {
    return Boolean(loadCredentials())
  } catch {
    return false
  }
}

export function projectId() {
  return loadCredentials()?.project_id || ''
}

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

/** 获取 access token（带缓存） */
export async function getAccessToken() {
  const creds = loadCredentials()
  if (!creds) throw new Error('未找到 GCP 服务账号凭证')

  if (cache.token && Date.now() < cache.expiresAt - 5 * 60 * 1000) return cache.token

  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(
    JSON.stringify({
      iss: creds.client_email,
      scope: SCOPE,
      aud: creds.token_uri || 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    }),
  )
  const unsigned = `${header}.${claims}`
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(creds.private_key)
  const jwt = `${unsigned}.${signature.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}`

  const res = await fetch(creds.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  if (!res.ok) {
    throw new Error(`获取 GCP access token 失败 ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  const data = await res.json()
  cache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  }
  return cache.token
}

/** 带认证的 Vertex AI 请求 */
export async function gcpFetch(url, init = {}) {
  const token = await getAccessToken()
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Vertex AI ${res.status}: ${body.slice(0, 500)}`)
  }
  return res.json()
}
