import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ApiProvider, KeyStatus } from '@shared/types'
import { getDb } from './db'
import { dataDir } from './paths'
import { getSettings } from './settings'

const PROVIDERS: ApiProvider[] = ['higgsfield', 'gemini', 'elevenlabs', 'openrouter', 'groq', 'custom']

export const PROVIDER_NAMES: Record<ApiProvider, string> = {
  higgsfield: 'Higgsfield',
  gemini: 'Google Gemini',
  elevenlabs: 'ElevenLabs',
  openrouter: 'OpenRouter',
  groq: 'Groq',
  custom: 'endpoint custom'
}

interface SecretRow {
  provider: ApiProvider
  value: Buffer
  last_ok: number | null
  last_message: string | null
  checked_at: number | null
}

/**
 * API keys are encrypted at rest with AES-256-GCM. The key comes from SECRETS_KEY (any string) or, when unset,
 * from a random file in the data folder. Copying studio.db alone therefore does not reveal the keys.
 */
let masterKey: Buffer | null = null

function key(): Buffer {
  if (masterKey) return masterKey
  const fromEnv = process.env.SECRETS_KEY?.trim()
  if (fromEnv) {
    masterKey = createHash('sha256').update(fromEnv).digest()
    return masterKey
  }
  const file = join(dataDir(), '.secret-key')
  if (!existsSync(file)) {
    writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 })
    try {
      chmodSync(file, 0o600)
    } catch {
      // Best effort on file systems without permissions.
    }
  }
  masterKey = Buffer.from(readFileSync(file, 'utf8').trim(), 'hex')
  return masterKey
}

const PREFIX = Buffer.from('v1:')

function encrypt(value: string): Buffer {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  const body = Buffer.concat([c.update(value, 'utf8'), c.final()])
  return Buffer.concat([PREFIX, iv, c.getAuthTag(), body])
}

function decrypt(value: Buffer): string | null {
  try {
    if (!value.subarray(0, PREFIX.length).equals(PREFIX)) return null
    const iv = value.subarray(3, 15)
    const tag = value.subarray(15, 31)
    const d = createDecipheriv('aes-256-gcm', key(), iv)
    d.setAuthTag(tag)
    return Buffer.concat([d.update(value.subarray(31)), d.final()]).toString('utf8')
  } catch {
    return null
  }
}

function mask(key: string): string {
  if (key.length <= 10) return '•'.repeat(Math.max(4, key.length))
  return `${key.slice(0, Math.min(8, Math.floor(key.length / 3)))}${'•'.repeat(10)}${key.slice(-4)}`
}

function row(provider: ApiProvider): SecretRow | undefined {
  return getDb().prepare('SELECT * FROM secrets WHERE provider = ?').get(provider) as SecretRow | undefined
}

export function setSecret(provider: ApiProvider, value: string): void {
  const enc = encrypt(value)
  getDb()
    .prepare(
      `INSERT INTO secrets (provider, value) VALUES (?, ?)
       ON CONFLICT(provider) DO UPDATE SET value = excluded.value, last_ok = NULL, last_message = NULL, checked_at = NULL`
    )
    .run(provider, enc)
}

export function getSecret(provider: ApiProvider): string | null {
  const r = row(provider)
  if (!r || r.value.length === 0) return null
  const value = decrypt(r.value)
  if (value == null)
    throw new Error(
      `Kunci ${PROVIDER_NAMES[provider]} tersimpan tapi tidak bisa dibuka lagi (biasanya karena SECRETS_KEY di server berubah). Masukkan ulang kuncinya di Pengaturan.`
    )
  return value
}

export function requireSecret(provider: ApiProvider): string {
  const key = getSecret(provider)
  if (!key) throw new Error(`Kunci API ${PROVIDER_NAMES[provider]} belum diatur. Buka Pengaturan untuk menambahkannya.`)
  return key
}

/** Full key for the "show key" button; null when missing or unreadable. */
export function revealSecret(provider: ApiProvider): string | null {
  const r = row(provider)
  return r && r.value.length ? decrypt(r.value) : null
}

export function clearSecret(provider: ApiProvider): void {
  getDb().prepare('DELETE FROM secrets WHERE provider = ?').run(provider)
}

/** Test results for the custom endpoint are kept even when it has no key (local servers). */
export function recordCheck(provider: ApiProvider, ok: boolean, message: string): void {
  const now = Date.now()
  const res = getDb()
    .prepare('UPDATE secrets SET last_ok = ?, last_message = ?, checked_at = ? WHERE provider = ?')
    .run(ok ? 1 : 0, message, now, provider)
  if (res.changes === 0 && provider === 'custom') {
    getDb()
      .prepare('INSERT INTO secrets (provider, value, last_ok, last_message, checked_at) VALUES (?, ?, ?, ?, ?)')
      .run(provider, Buffer.alloc(0), ok ? 1 : 0, message, now)
  }
}

export function keyStatuses(): KeyStatus[] {
  const rows = getDb().prepare('SELECT * FROM secrets').all() as SecretRow[]
  const customUrl = getSettings().customBaseUrl.trim()
  return PROVIDERS.map((provider) => {
    const r = rows.find((x) => x.provider === provider)
    const hasKey = !!r && r.value.length > 0
    const value = hasKey ? decrypt(r!.value) : null
    const unreadable = hasKey && value == null
    return {
      provider,
      configured: provider === 'custom' ? !!customUrl : hasKey,
      lastOk: unreadable ? false : r?.last_ok == null ? null : r.last_ok === 1,
      lastMessage: unreadable ? 'Kunci tersimpan tapi tidak bisa dibuka lagi. Masukkan ulang kuncinya.' : (r?.last_message ?? null),
      checkedAt: r?.checked_at ?? null,
      preview: value ? mask(value) : null,
      unreadable
    }
  })
}
