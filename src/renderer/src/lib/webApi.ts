import { EVENTS, type StudioApi } from '@shared/api'

/**
 * The browser side of the old Electron preload: the same `window.api` surface, but each call is an HTTP request
 * to the server, and events arrive over one Server-Sent Events stream.
 */

async function readJson(res: Response): Promise<{ result?: unknown; error?: string }> {
  try {
    return await res.json()
  } catch {
    return {}
  }
}

function failure(res: Response, body: { error?: string }): Error {
  if (res.status === 401) {
    // The session ran out; the login page is the only way back in.
    window.location.href = '/login'
    return new Error('Sesi berakhir. Masuk lagi.')
  }
  return new Error(body.error ?? `Permintaan gagal (${res.status})`)
}

const call =
  <T>(channel: string) =>
  async (...args: unknown[]): Promise<T> => {
    const res = await fetch(`/api/rpc/${channel}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args })
    })
    const body = await readJson(res)
    if (!res.ok) throw failure(res, body)
    return body.result as T
  }

async function upload<T>(kind: 'music' | 'image', projectId: string, file: File): Promise<T> {
  const url = `/api/upload/${kind}?projectId=${encodeURIComponent(projectId)}&name=${encodeURIComponent(file.name)}`
  const res = await fetch(url, { method: 'POST', body: file })
  const body = await readJson(res)
  if (!res.ok) throw failure(res, body)
  return body.result as T
}

type Listener = (payload: never) => void
const listeners = new Map<string, Set<Listener>>()
let source: EventSource | null = null

function ensureStream(): void {
  if (source) return
  source = new EventSource('/api/events')
  for (const channel of Object.values(EVENTS)) {
    source.addEventListener(channel, (e) => {
      const payload = JSON.parse((e as MessageEvent<string>).data)
      for (const cb of listeners.get(channel) ?? []) cb(payload as never)
    })
  }
}

const listen =
  <T>(channel: string) =>
  (cb: (payload: T) => void): (() => void) => {
    ensureStream()
    const set = listeners.get(channel) ?? new Set<Listener>()
    set.add(cb as Listener)
    listeners.set(channel, set)
    return () => void set.delete(cb as Listener)
  }

export const api: StudioApi = {
  projects: {
    list: call('projects:list'),
    create: call('projects:create'),
    get: call('projects:get'),
    save: call('projects:save'),
    remove: call('projects:remove'),
    duplicate: call('projects:duplicate')
  },
  story: {
    script: call('story:script'),
    visuals: call('story:visuals'),
    musicPrompt: call('story:musicPrompt'),
    manualPrompt: call('story:manualPrompt'),
    manualApply: call('story:manualApply')
  },
  generate: {
    clipImage: call('generate:clipImage'),
    clipVideo: call('generate:clipVideo'),
    clipTts: call('generate:clipTts'),
    characterSheet: call('generate:characterSheet'),
    missingImages: call('generate:missingImages'),
    missingVideos: call('generate:missingVideos'),
    missingTts: call('generate:missingTts'),
    narration: call('generate:narration'),
    syncCaptions: call('generate:syncCaptions'),
    cancel: call('generate:cancel'),
    manualPrompt: call('generate:manualPrompt'),
    estimate: call('generate:estimate')
  },
  clips: {
    split: call('clips:split'),
    detachVoice: call('clips:detachVoice')
  },
  assets: {
    setActive: call('assets:setActive'),
    setWords: call('assets:setWords'),
    uploadMusic: (projectId, file) => upload('music', projectId, file),
    uploadImage: (projectId, file) => upload('image', projectId, file),
    uploadMedia: async (target, id, file) => {
      const res = await fetch(`/api/upload/media?target=${target}&id=${encodeURIComponent(id)}&name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file })
      const body = await readJson(res)
      if (!res.ok) throw failure(res, body)
      return body.result as never
    }
  },
  settings: {
    get: call('settings:get'),
    set: call('settings:set'),
    keys: call('settings:keys'),
    setKey: call('settings:setKey'),
    setCustom: call('settings:setCustom'),
    clearKey: call('settings:clearKey'),
    revealKey: call('settings:revealKey'),
    testKey: call('settings:testKey'),
    voices: call('settings:voices')
  },
  ideas: {
    trending: call('ideas:trending'),
    manualPrompt: call('ideas:manualPrompt'),
    manualApply: call('ideas:manualApply')
  },
  models: {
    list: call('models:list')
  },
  exporter: {
    start: call('export:start'),
    downloadUrl: (path) => `/download/export/${encodeURIComponent(path.split(/[\\/]/).pop() ?? '')}`
  },
  app: {
    openExternal: async (url) => {
      if (/^https:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer')
    },
    copyText: async (text) => {
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        // Clipboard is blocked on plain http; fall back to a temporary textarea.
        const t = document.createElement('textarea')
        t.value = text
        document.body.appendChild(t)
        t.select()
        document.execCommand('copy')
        t.remove()
      }
    },
    version: call('app:version')
  },
  whisper: {
    status: call('whisper:status'),
    download: call('whisper:download'),
    cancel: call('whisper:cancel'),
    remove: call('whisper:remove')
  },
  on: {
    whisper: listen(EVENTS.whisper),
    job: listen(EVENTS.job),
    clip: listen(EVENTS.clip),
    character: listen(EVENTS.character),
    asset: listen(EVENTS.asset)
  }
}

window.api = api
