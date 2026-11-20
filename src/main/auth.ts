import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

/**
 * One shared password protects the whole app, because it holds the owner's API keys and projects.
 * A signed cookie keeps the browser logged in; changing APP_PASSWORD logs everyone out.
 */
const COOKIE = 'bs_session'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

const password = (): string => process.env.APP_PASSWORD ?? ''
export const authEnabled = (): boolean => password() !== '' && process.env.AUTH_DISABLED !== '1'

function signingKey(): Buffer {
  const secret = process.env.SESSION_SECRET || password()
  return createHash('sha256').update(`bang-story-session:${secret}`).digest()
}

const sign = (value: string): string => createHmac('sha256', signingKey()).update(value).digest('hex')

function safeEqual(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest()
  const y = createHash('sha256').update(b).digest()
  return timingSafeEqual(x, y)
}

export function passwordMatches(input: string): boolean {
  return safeEqual(input, password())
}

export function sessionCookie(secure: boolean): string {
  const exp = String(Date.now() + MAX_AGE_MS)
  const value = `${exp}.${sign(exp)}`
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_MS / 1000}${secure ? '; Secure' : ''}`
}

export const clearCookie = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

export function isLoggedIn(req: Request): boolean {
  if (!authEnabled()) return true
  const raw = readCookie(req, COOKIE)
  if (!raw) return false
  const [exp, mac] = raw.split('.')
  if (!exp || !mac || !safeEqual(mac, sign(exp))) return false
  return Number(exp) > Date.now()
}

/** Failed logins per IP, so the password cannot be guessed quickly. */
const failures = new Map<string, { count: number; first: number }>()
const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES = 8

export function loginBlocked(ip: string): boolean {
  const f = failures.get(ip)
  if (!f) return false
  if (Date.now() - f.first > WINDOW_MS) {
    failures.delete(ip)
    return false
  }
  return f.count >= MAX_FAILURES
}

export function recordLogin(ip: string, ok: boolean): void {
  if (ok) return void failures.delete(ip)
  const f = failures.get(ip)
  if (!f || Date.now() - f.first > WINDOW_MS) failures.set(ip, { count: 1, first: Date.now() })
  else f.count++
}

export function requireLogin(req: Request, res: Response, next: NextFunction): void {
  if (isLoggedIn(req)) return next()
  if (req.path.startsWith('/api/') || req.path.startsWith('/media/') || req.path.startsWith('/download/')) {
    res.status(401).json({ error: 'Sesi berakhir. Muat ulang halaman lalu masuk lagi.' })
    return
  }
  res.redirect('/login')
}

export function loginPage(error?: string): string {
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Masuk · EverTwo Story</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#faf7f2;color:#1f1b16;font-family:system-ui,sans-serif;padding:16px}
form{width:100%;max-width:340px;display:flex;flex-direction:column;gap:12px;background:#fff;border:1px solid #e6dfd3;border-radius:14px;padding:24px}
h1{margin:0 0 4px;font-size:1.4rem}p{margin:0;color:#6b6358;font-size:.92rem}
input{font:inherit;padding:10px 12px;border:1px solid #d6cdbd;border-radius:8px}
button{font:inherit;font-weight:600;padding:10px 12px;border:0;border-radius:8px;background:#d6502b;color:#fff;cursor:pointer}
.err{color:#b42318;font-size:.9rem}
</style></head><body>
<form method="post" action="/login">
<h1>EverTwo Story</h1><p>Masukkan kata sandi untuk lanjut.</p>
${error ? `<div class="err">${error}</div>` : ''}
<input type="password" name="password" placeholder="Kata sandi" autocomplete="current-password" autofocus required>
<button type="submit">Masuk</button>
</form></body></html>`
}
