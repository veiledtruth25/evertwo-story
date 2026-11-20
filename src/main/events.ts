import type { ServerResponse } from 'node:http'
import { EVENTS } from '@shared/api'
import type { Asset, CharacterPatchEvent, ClipPatchEvent, Job, WhisperStatus } from '@shared/types'

/** Browsers listening on /api/events (Server-Sent Events). Replaces the Electron window broadcast. */
const clients = new Set<ServerResponse>()

export function addEventClient(res: ServerResponse): () => void {
  clients.add(res)
  return () => clients.delete(res)
}

function send(channel: string, payload: unknown): void {
  const frame = `event: ${channel}\ndata: ${JSON.stringify(payload)}\n\n`
  for (const res of clients) {
    try {
      res.write(frame)
    } catch {
      clients.delete(res)
    }
  }
}

/** Keeps idle connections open through reverse proxies, which close silent streams after about a minute. */
export function pingEventClients(): void {
  for (const res of clients) {
    try {
      res.write(': ping\n\n')
    } catch {
      clients.delete(res)
    }
  }
}

export const emit = {
  job: (job: Job): void => send(EVENTS.job, job),
  clip: (e: ClipPatchEvent): void => send(EVENTS.clip, e),
  character: (e: CharacterPatchEvent): void => send(EVENTS.character, e),
  asset: (asset: Asset): void => send(EVENTS.asset, asset),
  whisper: (status: WhisperStatus): void => send(EVENTS.whisper, status)
}
