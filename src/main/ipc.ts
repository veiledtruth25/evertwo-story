import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, extname } from 'node:path'
import type {
  ApiProvider,
  AppSettings,
  AspectRatio,
  Asset,
  ExportOptions,
  KeyTestResult,
  ModelSource,
  NewProjectInput,
  ProjectSnapshot,
  TtsProvider,
  VoiceOption,
  WordTiming
} from '@shared/types'
import { startExport } from './exporter'
import {
  estimateCredits,
  forgetEstimates,
  generateCharacterSheet,
  generateClipImage,
  generateClipTts,
  generateClipVideo,
  generateMissingImages,
  generateMissingVideos,
  generateMissingTts,
  importManualMedia,
  manualMediaPrompt,
  setActiveAsset,
  type ManualTarget
} from './generation'
import { cancelJob } from './jobs'
import { generateNarration, syncCaptions } from './narration'
import { cancelDownload, downloadModel, removeModel, whisperStatus } from './whisper'
import { assetAbsPath } from './paths'
import { detachVoice, splitClip } from './editing'
import { emit } from './events'
import pkg from '../../package.json'
import {
  createProject,
  duplicateProject,
  getAsset,
  getBundle,
  getProject,
  insertAsset,
  listProjects,
  removeProject,
  saveSnapshot,
  updateAssetMeta
} from './repo'
import { clearSecret, keyStatuses, recordCheck, revealSecret, setSecret } from './secrets'
import { dropCache, getSettings, setSettings } from './settings'
import { probeDurationMs, probeSize } from './services/audio'
import * as eleven from './services/elevenlabs'
import * as piper from './services/piper'
import { applyManualIdeas, manualIdeasPrompt, trendingIdeas } from './services/trends'
import * as gemini from './services/gemini'
import * as hf from './services/higgsfield'
import * as llm from './services/llm'
import { generateScript, generateVisuals, generateMusicPrompt, manualApply, manualPrompt } from './story'


type Handler = (...args: any[]) => unknown

/** The RPC table behind POST /api/rpc/:channel. Channel names are the ones the Electron build used for IPC. */
const handlers = new Map<string, Handler>()

function handle(channel: string, fn: Handler): void {
  handlers.set(channel, fn)
}

export async function callRpc(channel: string, args: unknown[]): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`Perintah tidak dikenal: ${channel}`)
  return fn(...args)
}

async function testProvider(provider: ApiProvider, key?: string): Promise<KeyTestResult> {
  if (provider === 'higgsfield') return hf.testCredentials(key)
  if (provider === 'elevenlabs') return eleven.testKey(key)
  return llm.testLlm(provider, key)
}

function registerAll(): void {
  handle('projects:list', () => listProjects())
  handle('projects:create', (input: NewProjectInput) => getBundle(createProject(input).id))
  handle('projects:get', (id: string) => getBundle(id))
  handle('projects:save', (snap: ProjectSnapshot) => ({ updatedAt: saveSnapshot(snap) }))
  handle('projects:remove', (id: string) => removeProject(id))
  handle('projects:duplicate', (id: string) => duplicateProject(id))

  handle('story:script', (projectId: string) => generateScript(projectId))
  handle('story:musicPrompt', (projectId: string) => generateMusicPrompt(projectId))
  handle('story:visuals', (projectId: string, mode: 'missing' | 'all') => generateVisuals(projectId, mode === 'all' ? 'all' : 'missing'))

  // Manual mode: no API call, the user pastes the prompt into an online AI and pastes the JSON reply back.
  handle('story:manualPrompt', (projectId: string, kind: 'script' | 'visuals', mode: 'missing' | 'all') => manualPrompt(projectId, kind === 'visuals' ? 'visuals' : 'script', mode === 'all' ? 'all' : 'missing'))
  handle('story:manualApply', (projectId: string, kind: 'script' | 'visuals', mode: 'missing' | 'all', reply: string) =>
    manualApply(projectId, kind === 'visuals' ? 'visuals' : 'script', mode === 'all' ? 'all' : 'missing', String(reply ?? ''))
  )

  handle('generate:manualPrompt', (target: ManualTarget, id: string) => manualMediaPrompt(target, id))
  handle('generate:clipImage', (clipId: string) => generateClipImage(clipId))
  handle('generate:clipVideo', (clipId: string) => generateClipVideo(clipId))
  handle('generate:clipTts', (clipId: string) => generateClipTts(clipId))
  handle('generate:characterSheet', (characterId: string) => generateCharacterSheet(characterId))
  handle('generate:missingImages', (projectId: string) => generateMissingImages(projectId))
  handle('generate:missingVideos', (projectId: string) => generateMissingVideos(projectId))
  handle('generate:missingTts', (projectId: string) => generateMissingTts(projectId))
  handle('generate:narration', (projectId: string, mode: 'missing' | 'all') => generateNarration(projectId, mode === 'all' ? 'all' : 'missing'))
  handle('generate:syncCaptions', (projectId: string, mode?: 'stale' | 'all') => syncCaptions(projectId, mode === 'all' ? 'all' : 'stale'))

  handle('whisper:status', () => whisperStatus())
  // The download runs in the background and reports through whisper events.
  handle('whisper:download', () => {
    void downloadModel().catch(() => {})
  })
  handle('whisper:cancel', () => cancelDownload())
  handle('whisper:remove', () => removeModel())
  handle('generate:cancel', (jobId: string) => cancelJob(jobId))
  handle('generate:estimate', (kind: 'image' | 'video', modelId: string, aspect: AspectRatio, seconds?: number, resolution?: string | null) =>
    estimateCredits(kind, modelId, aspect, seconds, resolution)
  )

  handle('assets:setActive', (clipId: string, assetId: string) => setActiveAsset(clipId, assetId))
  handle('clips:split', (clipId: string, atMs: number) => splitClip(clipId, Number(atMs)))
  handle('clips:detachVoice', (clipId: string) => detachVoice(clipId))
  // Caption text fixed by hand in the editor; the words keep their times.
  handle('assets:setWords', (assetId: string, words: WordTiming[]) => {
    const a = getAsset(assetId)
    if (!a || a.kind !== 'audio') throw new Error('Suara klip tidak ditemukan')
    const clean = (Array.isArray(words) ? words : [])
      .filter((w) => w && typeof w.text === 'string' && w.text.trim() && Number.isFinite(w.start) && Number.isFinite(w.end))
      .map((w) => ({ text: w.text.trim(), start: Math.max(0, w.start), end: Math.max(w.start, w.end) }))
    updateAssetMeta(a.id, { ...a.meta, words: clean, editedWords: true })
    const fresh = getAsset(a.id)!
    emit.asset(fresh)
    return fresh
  })
  handle('settings:get', () => getSettings())
  handle('settings:set', (patch: Partial<AppSettings>) => setSettings(patch))
  handle('settings:keys', () => keyStatuses())
  handle('settings:setKey', async (provider: ApiProvider, key: string) => {
    const clean = key.trim()
    if (!clean) throw new Error('Kunci masih kosong')
    setSecret(provider, clean)
    dropCache(`models:${provider}`)
    if (provider === 'gemini') dropCache('models:gemini-tts')
    if (provider === 'higgsfield') forgetEstimates()
    const result = await testProvider(provider, clean)
    recordCheck(provider, result.ok, result.message)
    return result
  })
  handle('settings:setCustom', async (baseUrl: string, key: string) => {
    const url = baseUrl.trim().replace(/\/+$/, '')
    if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error('Alamat endpoint harus diawali http:// atau https://')
    setSettings({ customBaseUrl: url })
    if (key.trim()) setSecret('custom', key.trim())
    dropCache('models:custom')
    const result = await llm.testLlm('custom', key.trim() || undefined, url)
    recordCheck('custom', result.ok, result.message)
    return result
  })
  handle('settings:clearKey', (provider: ApiProvider) => {
    clearSecret(provider)
    dropCache(`models:${provider}`)
    if (provider === 'higgsfield') forgetEstimates()
    if (provider === 'custom') setSettings({ customBaseUrl: '' })
  })
  handle('ideas:trending', (language: string, refresh?: boolean) => trendingIdeas(language, !!refresh))
  handle('ideas:manualPrompt', (language: string) => manualIdeasPrompt(language))
  handle('ideas:manualApply', (language: string, reply: string) => applyManualIdeas(language, reply))
  handle('models:list', (source: ModelSource, refresh?: boolean) => llm.listModels(source, !!refresh))
  handle('settings:testKey', async (provider: ApiProvider) => {
    const result = await testProvider(provider).catch((e): KeyTestResult => ({ ok: false, message: (e as Error).message }))
    recordCheck(provider, result.ok, result.message)
    return result
  })
  handle('settings:revealKey', (provider: ApiProvider) => revealSecret(provider))
  handle('settings:voices', async (provider: TtsProvider, language?: string): Promise<VoiceOption[]> => {
    if (provider === 'piper') return piper.listVoices(language)
    if (provider === 'gemini') return gemini.listVoices()
    return eleven.listVoices()
  })

  handle('export:start', (projectId: string, opts: ExportOptions) => startExport(projectId, opts))
  handle('app:version', () => pkg.version)
}

export { importManualMedia }

/** A music file uploaded from the browser becomes a project asset. */
export async function importMusic(projectId: string, fileName: string, data: Buffer): Promise<Asset> {
  getProject(projectId)
  const ext = extname(fileName).toLowerCase()
  if (!['.mp3', '.wav', '.m4a', '.ogg'].includes(ext)) throw new Error('Pakai file audio MP3, WAV, M4A, atau OGG.')
  const rel = `music/${randomUUID()}${ext}`
  const abs = assetAbsPath(projectId, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, data)
  const durationMs = await probeDurationMs(abs).catch(() => null)
  return insertAsset({ projectId, kind: 'music', provider: 'local', prompt: fileName || 'musik', localPath: rel, durationMs })
}

/** A logo or watermark uploaded from the browser becomes an overlay asset. */
export async function importOverlayImage(projectId: string, fileName: string, data: Buffer): Promise<Asset> {
  getProject(projectId)
  const ext = extname(fileName).toLowerCase()
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) throw new Error('Gambar tidak bisa dibaca. Pakai file PNG, JPG, atau WebP.')
  const rel = `overlays/${randomUUID()}${ext}`
  const abs = assetAbsPath(projectId, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, data)
  const size = await probeSize(abs).catch(() => null)
  if (!size) throw new Error('Gambar tidak bisa dibaca. Pakai file PNG, JPG, atau WebP.')
  return insertAsset({ projectId, kind: 'overlay', provider: 'local', prompt: fileName || 'gambar', localPath: rel, width: size.width, height: size.height })
}

registerAll()
