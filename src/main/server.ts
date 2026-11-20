import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import express, { type Request, type Response } from 'express'
import { authEnabled, clearCookie, isLoggedIn, loginBlocked, loginPage, passwordMatches, recordLogin, requireLogin, sessionCookie } from './auth'
import { addEventClient } from './events'
import { callRpc, importManualMedia, importMusic, importOverlayImage } from './ipc'
import { exportsDir, fontsDir, projectsRoot } from './paths'

const NO_CACHE = 'no-cache'

/** Static files (the built React app) live next to the server bundle: out/web. */
function webRoot(): string {
  return resolve(process.env.WEB_DIR ?? join(process.cwd(), 'out', 'web'))
}

function sendError(res: Response, e: unknown, status = 500): void {
  res.status(status).json({ error: (e as Error)?.message ?? String(e) })
}

/** Streams a file from `root` with Range support, so audio and video can seek. Rejects paths that leave `root`. */
function sendFrom(root: string, rel: string, res: Response, download?: string): void {
  const opts = { root, dotfiles: 'allow' as const, cacheControl: false, headers: { 'Cache-Control': NO_CACHE } }
  const done = (err?: Error & { status?: number }): void => {
    if (err && !res.headersSent) res.status(err.status === 403 || err.status === 404 ? err.status : 404).end()
  }
  if (download) res.download(rel, download, opts, done)
  else res.sendFile(rel, opts, done)
}

export function createServer(): express.Express {
  const app = express()
  app.disable('x-powered-by')
  // Behind Nginx Proxy Manager the real client address and protocol arrive in X-Forwarded-* headers.
  app.set('trust proxy', 1)

  app.get('/healthz', (_req, res) => void res.type('text').send('ok'))

  app.get('/login', (req, res) => {
    if (isLoggedIn(req)) return res.redirect('/')
    res.type('html').send(loginPage())
  })
  app.post('/login', express.urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
    const ip = req.ip ?? 'unknown'
    if (loginBlocked(ip)) return void res.status(429).type('html').send(loginPage('Terlalu banyak percobaan. Coba lagi beberapa menit lagi.'))
    const ok = passwordMatches(String(req.body?.password ?? ''))
    recordLogin(ip, ok)
    if (!ok) return void res.status(401).type('html').send(loginPage('Kata sandi salah.'))
    res.setHeader('Set-Cookie', sessionCookie(req.secure))
    res.redirect('/')
  })
  app.post('/logout', (_req, res) => {
    res.setHeader('Set-Cookie', clearCookie)
    res.redirect('/login')
  })

  app.use(requireLogin)

  app.post('/api/rpc/:channel', express.json({ limit: '50mb' }), async (req: Request, res: Response) => {
    try {
      const args = Array.isArray(req.body?.args) ? req.body.args : []
      const result = await callRpc(String(req.params.channel), args)
      res.json({ result: result === undefined ? null : result })
    } catch (e) {
      sendError(res, e)
    }
  })

  // Uploads arrive as the raw file body, with the original name in the query string.
  const upload = express.raw({ type: () => true, limit: '300mb' })
  const uploadRoute = (importer: typeof importMusic) => async (req: Request, res: Response) => {
    try {
      const projectId = String(req.query.projectId ?? '')
      const name = String(req.query.name ?? '')
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new Error('File kosong.')
      res.json({ result: await importer(projectId, name, req.body) })
    } catch (e) {
      sendError(res, e, 400)
    }
  }
  app.post('/api/upload/media', upload, async (req: Request, res: Response) => {
    try {
      const target = String(req.query.target ?? '')
      if (target !== 'clip-image' && target !== 'clip-video' && target !== 'sheet') throw new Error('Jenis unggahan tidak dikenal.')
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new Error('File kosong.')
      res.json({ result: await importManualMedia(target, String(req.query.id ?? ''), String(req.query.name ?? ''), req.body) })
    } catch (e) {
      sendError(res, e, 400)
    }
  })
  app.post('/api/upload/music', upload, uploadRoute(importMusic))
  app.post('/api/upload/image', upload, uploadRoute(importOverlayImage))

  app.get('/api/events', (req: Request, res: Response) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Tells nginx (and so Nginx Proxy Manager) not to buffer the stream.
      'X-Accel-Buffering': 'no'
    })
    res.write('retry: 2000\n\n')
    const remove = addEventClient(res)
    req.on('close', remove)
  })

  app.get('/media/asset/*rel', (req, res) => sendFrom(projectsRoot(), decodeURIComponent(req.path.slice('/media/asset/'.length)), res))
  app.get('/media/fonts/*rel', (req, res) => sendFrom(fontsDir(), decodeURIComponent(req.path.slice('/media/fonts/'.length)), res))
  app.get('/download/export/:file', (req, res) => {
    const file = basename(String(req.params.file))
    sendFrom(exportsDir(), file, res, file)
  })

  const root = webRoot()
  if (existsSync(root)) {
    app.use(express.static(root, { index: false, setHeaders: (res, path) => void (path.includes('/assets/') ? res.setHeader('Cache-Control', 'public, max-age=31536000, immutable') : res.setHeader('Cache-Control', NO_CACHE)) }))
    app.get(/.*/, (_req, res) => res.sendFile(join(root, 'index.html'), { headers: { 'Cache-Control': NO_CACHE } }))
  }
  return app
}

export function logAuthMode(): void {
  if (authEnabled()) console.log('[auth] login dengan APP_PASSWORD aktif')
  else console.warn('[auth] PERINGATAN: tanpa kata sandi. Jangan buka ke internet.')
}
