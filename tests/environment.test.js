import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import dotenv from 'dotenv'
import { credentialsFromEnv } from '../server/providers/gcp-auth.js'

const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})
const fixture = {
  GCP_PROJECT_ID: 'example-project',
  GCP_CLIENT_EMAIL: 'example@example.invalid',
  GCP_PRIVATE_KEY: privateKey,
}

test('missing credentials supports demo mode and ignores legacy credential paths', () => {
  assert.equal(credentialsFromEnv({}), null)
  assert.equal(credentialsFromEnv({ GCP_CREDENTIALS_FILE: 'credentials/old.json' }), null)
  assert.equal(credentialsFromEnv({ GOOGLE_APPLICATION_CREDENTIALS: 'credentials/old.json' }), null)
})

test('dotenv preserves the complete RSA private key', () => {
  const parsed = dotenv.parse('GCP_PRIVATE_KEY=' + JSON.stringify(privateKey))
  const credentials = credentialsFromEnv({ ...fixture, ...parsed })
  assert.equal(credentials.private_key, privateKey)
  assert.equal(credentials.project_id, fixture.GCP_PROJECT_ID)
  const signature = crypto.sign('RSA-SHA256', Buffer.from('environment-test'), credentials.private_key)
  assert.ok(signature.length > 0)
})

test('injected environment variables may use escaped newlines', () => {
  const credentials = credentialsFromEnv({ ...fixture, GCP_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n') })
  assert.equal(credentials.private_key, privateKey)
})

test('incomplete or invalid credentials produce errors without including their values', () => {
  assert.throws(() => credentialsFromEnv({ GCP_PROJECT_ID: 'do-not-echo-project' }), e =>
    e.message.includes('GCP_CLIENT_EMAIL') && !e.message.includes('do-not-echo-project'))
  assert.throws(() => credentialsFromEnv({ ...fixture, GCP_PRIVATE_KEY: 'do-not-echo-key' }), e =>
    e.message.includes('GCP_PRIVATE_KEY') && !e.message.includes('do-not-echo-key'))
})

test('the committed environment template contains no actual credentials', () => {
  const example = dotenv.parse(fs.readFileSync(new URL('../.env.example', import.meta.url)))
  for (const name of ['GCP_PROJECT_ID', 'GCP_CLIENT_EMAIL', 'GCP_PRIVATE_KEY', 'LLM_API_KEY', 'IMAGE_API_KEY', 'VIDEO_API_KEY']) {
    assert.equal(example[name], '', name)
  }
})