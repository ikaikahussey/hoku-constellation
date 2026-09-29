/**
 * Secret-at-rest helpers. AES-256-GCM with APP_ENCRYPTION_KEY (32 bytes, base64) for values such as
 * team Slack webhook URLs; HMAC-SHA256 signatures for one-click links (unsubscribe, open tracking).
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

function key(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY
  if (!raw) throw new Error('APP_ENCRYPTION_KEY is not set')
  const k = Buffer.from(raw, 'base64')
  if (k.length !== 32) throw new Error('APP_ENCRYPTION_KEY must be 32 bytes, base64-encoded')
  return k
}

/** "v1:<iv>:<tag>:<ciphertext>" (base64url parts). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':')
}

export function decryptSecret(enc: string): string {
  const [v, iv, tag, ct] = enc.split(':')
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unrecognized ciphertext')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8')
}

function signingKey(): string {
  const k = process.env.APP_SIGNING_SECRET ?? process.env.APP_ENCRYPTION_KEY
  if (!k) throw new Error('APP_SIGNING_SECRET (or APP_ENCRYPTION_KEY) is not set')
  return k
}

export function sign(value: string): string {
  return createHmac('sha256', signingKey()).update(value).digest('base64url')
}

export function verify(value: string, signature: string | null | undefined): boolean {
  if (!signature) return false
  const expected = Buffer.from(sign(value))
  const got = Buffer.from(signature)
  return expected.length === got.length && timingSafeEqual(expected, got)
}
