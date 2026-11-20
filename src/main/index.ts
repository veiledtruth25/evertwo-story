import { authEnabled } from './auth'
import { pingEventClients } from './events'
import { closeDb, getDb } from './db'
import { resumeJobs } from './generation'
import { createServer, logAuthMode } from './server'

const port = Number(process.env.PORT ?? 8787)
const host = process.env.HOST ?? '0.0.0.0'

if (!authEnabled() && process.env.AUTH_DISABLED !== '1') {
  console.error('APP_PASSWORD belum diatur. Isi APP_PASSWORD, atau set AUTH_DISABLED=1 hanya untuk uji lokal.')
  process.exit(1)
}

getDb()
const server = createServer().listen(port, host, () => {
  console.log(`EverTwo Story berjalan di http://${host}:${port}`)
  logAuthMode()
  resumeJobs()
})

// Long generation jobs and SSE streams must not be cut by Node's default HTTP timeouts.
server.requestTimeout = 0
server.headersTimeout = 65_000
const ping = setInterval(pingEventClients, 25_000)

function shutdown(): void {
  clearInterval(ping)
  server.close()
  closeDb()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
