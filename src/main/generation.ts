import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { estimateWordTimings } from '@shared/captions'
import { stripVoiceTags } from '@shared/speech'
import { NO_MUSIC, getImageModel, getVideoModel, imageBody, maxRefs, promptLimit, videoBody, type HfModel } from '@shared/higgsfield'
import { GEMINI_MAX_REFS, geminiImageModelOf } from '@shared/geminiImage'
import { getStyle } from '@shared/styles'
import type { AspectRatio, Asset, Character, Clip, CreditEstimate, Job, Project, WordTiming } from '@shared/types'
import { getDb } from './db'
import { emit } from './events'
import { runJob, type TaskCtx } from './jobs'
import { assetAbsPath } from './paths'
import {
  activeJobFor,
  charactersOf,
  clipsOf,
  getAsset,
  getCharacter,
  getClip,
  getJob,
  getProject,
  insertAsset,
  insertJob,
  patchClip,
  setCharacterSheet,
  touchProject,
  unfinishedJobs,
  updateAssetMeta,
  updateJob
} from './repo'
import { dropCache, getSettings, readCache, writeCache } from './settings'
import { probeDurationMs, probeSize } from './services/audio'
import * as eleven from './services/elevenlabs'
import * as piper from './services/piper'
import * as gemini from './services/gemini'
import * as hf from './services/higgsfield'
import { downloadTo, sleep } from './services/http'

const DAY = 24 * 60 * 60 * 1000

function extFromType(contentType: string, url: string, fallback: string): string {
  if (/png/.test(contentType)) return '.png'
  if (/jpe?g/.test(contentType)) return '.jpg'
  if (/webp/.test(contentType)) return '.webp'
  if (/mp4/.test(contentType)) return '.mp4'
  const m = /\.(png|jpe?g|webp|mp4|mov)(\?|$)/i.exec(url)
  return m ? `.${m[1].toLowerCase()}` : fallback
}

function saveFile(projectId: string, folder: string, ext: string, bytes: Buffer): string {
  const rel = `${folder}/${randomUUID()}${ext}`
  const abs = assetAbsPath(projectId, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, bytes)
  return rel
}

/** A URL Higgsfield can fetch for a stored asset: its own recent result URL, or a fresh upload. */
async function publicUrlFor(asset: Asset, signal: AbortSignal): Promise<string> {
  if (asset.remoteUrl && asset.provider === 'higgsfield' && Date.now() - asset.createdAt < 6 * DAY) return asset.remoteUrl
  const up = asset.meta.uploadedUrl as string | undefined
  const at = asset.meta.uploadedAt as number | undefined
  if (up && at && Date.now() - at < 0.5 * DAY) return up
  const url = await hf.uploadFile(assetAbsPath(asset.projectId, asset.localPath), signal)
  updateAssetMeta(asset.id, { ...asset.meta, uploadedUrl: url, uploadedAt: Date.now() })
  return url
}

function imageProgress(ctx: TaskCtx, what: string) {
  return (status: hf.HfStatus, elapsed: number): void => {
    if (status === 'queued') ctx.progress(0.12, 'Mengantre di Higgsfield')
    else ctx.progress(0.15 + 0.75 * (1 - Math.exp(-elapsed / 45_000)), what)
  }
}

// ---------- prompts ----------

function characterLine(c: Character): string {
  return `${c.name}: ${c.description}`
}

/** Splits the storyboard's "Avoid:" line off the scene, so it can be phrased as a clear instruction. */
function splitAvoid(visual: string): { scene: string; avoid: string } {
  const lines = visual.split('\n')
  const i = lines.findIndex((l) => /^\s*avoid\s*:/i.test(l))
  if (i < 0) return { scene: visual.trim(), avoid: '' }
  const avoid = lines[i].replace(/^\s*avoid\s*:\s*/i, '').replace(/\.$/, '').trim()
  lines.splice(i, 1)
  return { scene: lines.join('\n').trim(), avoid }
}

/**
 * The image prompt for a clip. The scene comes first so the model gets the content right, then who the
 * characters are, then the art style. Clothing follows the scene's Wardrobe line when it has one, so a
 * character can change out of the outfit on their reference sheet (no spacesuit indoors).
 */
function clipPrompt(project: Project, clip: Clip, chars: Character[], refNames: string[], limit: number): string {
  const style = getStyle(project.styleId)
  const { scene, avoid } = splitAvoid(clip.visualPrompt)
  const wardrobe = /^\s*wardrobe\s*:/im.test(scene)
  const parts = [`Scene:\n${scene}`]
  if (chars.length)
    parts.push(
      `Recurring characters in this scene. Keep each one's body, face, hair and skin exactly as described${refNames.length ? ' and as on their reference sheet' : ''}.` +
        (wardrobe
          ? ' Their clothing follows the Wardrobe line of the scene: the default outfit only where it says so, otherwise the custom outfit.'
          : ' They wear their default outfit.') +
        `\n${chars.map(characterLine).join('\n')}`
    )
  if (refNames.length)
    parts.push(
      `Reference images are character sheets, in this order: ${refNames.join(', ')}. Use them for each character's identity, proportions and colors. ` +
        (wardrobe ? 'Copy the costume from a sheet only for characters whose Wardrobe line says "default outfit". ' : 'Match the costume to the sheet. ') +
        'Do not copy the sheet layout, poses or plain background.'
    )
  parts.push(`Art style: ${style.prompt}`)
  if (avoid) parts.push(`Must not appear in the image: ${avoid}.`)
  parts.push(`Frame format ${project.aspectRatio}, full-bleed composition.`)
  const full = parts.join('\n\n')
  if (full.length <= limit) return full
  // Models with short prompt limits get the scene first, so trimming only loses style detail.
  return [scene, chars.map(characterLine).join('; '), avoid && `Must not appear: ${avoid}.`, style.prompt].filter(Boolean).join('\n\n')
}

function sheetPrompt(project: Project, c: Character): string {
  const style = getStyle(project.styleId)
  return [
    style.prompt,
    `Character reference sheet for "${c.name}": ${c.description}. The character is ${style.characterHint}.`,
    'Show the SAME character three times side by side: front view, three-quarter view and side view, full body, neutral standing pose, evenly spaced, on a plain light neutral background (this overrides any background instruction above). Consistent proportions, costume and colors in all three views.'
  ].join('\n\n')
}

// ---------- waiting for character sheets ----------

async function waitForSheets(characterIds: string[], signal: AbortSignal): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < 15 * 60 * 1000) {
    const pending = characterIds.some((id) => activeJobFor({ characterId: id }, 'sheet'))
    if (!pending) return
    await sleep(2000, signal)
  }
}

async function referenceUrls(model: HfModel, chars: Character[], signal: AbortSignal): Promise<{ urls: string[]; names: string[] }> {
  const limit = maxRefs(model)
  if (limit === 0) return { urls: [], names: [] }
  await waitForSheets(
    chars.map((c) => c.id),
    signal
  )
  const urls: string[] = []
  const names: string[] = []
  for (const c of chars) {
    const fresh = getCharacter(c.id)
    const sheet = getAsset(fresh.sheetAssetId)
    if (!sheet || urls.length >= limit) continue
    urls.push(await publicUrlFor(sheet, signal))
    names.push(fresh.name)
  }
  return { urls, names }
}

// ---------- finishing a Higgsfield request (also used to resume after a restart) ----------

interface HfPayload {
  target: 'clip-image' | 'sheet' | 'clip-video'
  model: string
  prompt: string
}

async function finishHiggsfield(ctx: TaskCtx, job: Job, requestId: string, payload: HfPayload): Promise<string> {
  const isVideo = payload.target === 'clip-video'
  const result = await hf.waitForResult(
    requestId,
    imageProgress(ctx, isVideo ? 'Membuat video' : payload.target === 'sheet' ? 'Membuat lembar karakter' : 'Membuat gambar'),
    ctx.signal,
    isVideo ? 30 * 60 * 1000 : 15 * 60 * 1000
  )
  const url = isVideo ? result.video?.url : result.images?.[0]?.url
  if (!url) throw new Error('Higgsfield selesai tanpa file hasil')
  ctx.progress(0.93, 'Mengunduh hasil')
  const { bytes, contentType } = await downloadTo(url, ctx.signal)
  const rel = saveFile(job.projectId, isVideo ? 'videos' : 'images', extFromType(contentType, url, isVideo ? '.mp4' : '.png'), bytes)
  const abs = assetAbsPath(job.projectId, rel)
  const size = await probeSize(abs)
  const durationMs = isVideo ? await probeDurationMs(abs).catch(() => null) : null
  const asset = insertAsset({
    projectId: job.projectId,
    clipId: job.clipId,
    characterId: job.characterId,
    kind: isVideo ? 'video' : 'image',
    provider: 'higgsfield',
    model: payload.model,
    prompt: payload.prompt,
    remoteId: requestId,
    remoteUrl: url,
    localPath: rel,
    durationMs,
    width: size?.width ?? null,
    height: size?.height ?? null
  })
  emit.asset(asset)
  attachAsset(payload.target, job.projectId, job.clipId, job.characterId, asset)
  return asset.id
}

/** Puts a finished picture or video where it belongs: a character's sheet, or a clip's image or video. */
function attachAsset(target: HfPayload['target'], projectId: string, clipId: string | null, characterId: string | null, asset: Asset): void {
  if (target === 'sheet' && characterId) {
    setCharacterSheet(characterId, asset.id)
    emit.character({ characterId, patch: { sheetAssetId: asset.id } })
  } else if (target === 'clip-image' && clipId) {
    patchClip(clipId, { imageAssetId: asset.id })
    emit.clip({ clipId, patch: { imageAssetId: asset.id } })
    const project = getProject(projectId)
    const first = clipsOf(projectId)[0]
    if (!project.coverAssetId || first?.id === clipId) touchProject(projectId, { coverAssetId: asset.id })
  } else if (target === 'clip-video' && clipId) {
    const patch = { videoAssetId: asset.id, motionType: 'video' as const, mediaInMs: 0 }
    patchClip(clipId, patch)
    emit.clip({ clipId, patch })
  }
  touchProject(projectId)
}

const MIME_BY_EXT: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

/** Draws a clip picture or a character sheet with a Gemini image model instead of Higgsfield. */
function startGeminiImage(job: Job, target: 'clip-image' | 'sheet', model: string): Job {
  emit.job(job)
  return runJob(job, 'gemini', async (ctx) => {
    ctx.progress(0.05, 'Menyiapkan prompt')
    const project = getProject(job.projectId)
    let prompt: string
    let aspect: AspectRatio = project.aspectRatio
    const refs: gemini.ImageRef[] = []
    if (target === 'sheet') {
      prompt = sheetPrompt(project, getCharacter(job.characterId!))
      aspect = '16:9'
    } else {
      const clip = getClip(job.clipId!)
      const chars = charactersOf(project.id).filter((c) => clip.characterIds.includes(c.id))
      await waitForSheets(chars.map((c) => c.id), ctx.signal)
      const names: string[] = []
      for (const c of chars) {
        const sheet = getAsset(getCharacter(c.id).sheetAssetId)
        if (!sheet || refs.length >= GEMINI_MAX_REFS) continue
        const ext = /\.[a-z0-9]+$/i.exec(sheet.localPath)?.[0].toLowerCase() ?? ''
        refs.push({ mimeType: MIME_BY_EXT[ext] ?? 'image/png', data: readFileSync(assetAbsPath(sheet.projectId, sheet.localPath)).toString('base64') })
        names.push(c.name)
      }
      prompt = clipPrompt(project, clip, chars, names, Number.MAX_SAFE_INTEGER)
    }
    ctx.progress(0.2, 'Membuat gambar dengan Gemini')
    const { bytes, mimeType } = await gemini.generateImage(model, prompt, aspect, refs)
    ctx.progress(0.93, 'Menyimpan hasil')
    const rel = saveFile(job.projectId, 'images', extFromType(mimeType, '', '.png'), bytes)
    const size = await probeSize(assetAbsPath(job.projectId, rel))
    const asset = insertAsset({
      projectId: job.projectId,
      clipId: job.clipId,
      characterId: job.characterId,
      kind: 'image',
      provider: 'gemini',
      model,
      prompt,
      localPath: rel,
      width: size?.width ?? null,
      height: size?.height ?? null
    })
    emit.asset(asset)
    attachAsset(target, job.projectId, job.clipId, job.characterId, asset)
    return asset.id
  })
}

function startHiggsfield(job: Job, build: (ctx: TaskCtx) => Promise<{ endpoint: string; body: Record<string, unknown>; payload: HfPayload }>): Job {
  emit.job(job)
  return runJob(job, 'higgsfield', async (ctx) => {
    ctx.progress(0.04, 'Menyiapkan prompt')
    const { endpoint, body, payload } = await build(ctx)
    ctx.progress(0.08, 'Mengirim ke Higgsfield')
    const requestId = await hf.submit(endpoint, body, ctx.signal)
    ctx.setRemote(requestId)
    updateJobPayload(job.id, payload)
    return finishHiggsfield(ctx, job, requestId, payload)
  })
}

function updateJobPayload(jobId: string, payload: HfPayload): void {
  getDb().prepare('UPDATE jobs SET payload_json = ? WHERE id = ?').run(JSON.stringify(payload), jobId)
}

// ---------- public entry points ----------

export function generateClipImage(clipId: string): Job {
  const existing = activeJobFor({ clipId }, 'image')
  if (existing) return existing
  const clip = getClip(clipId)
  const gem = geminiImageModelOf(getProject(clip.projectId).imageModel)
  if (gem) return startGeminiImage(insertJob({ projectId: clip.projectId, clipId, kind: 'image', provider: 'gemini' }), 'clip-image', gem)
  const job = insertJob({ projectId: clip.projectId, clipId, kind: 'image', provider: 'higgsfield' })
  return startHiggsfield(job, async (ctx) => {
    const fresh = getClip(clipId)
    const project = getProject(fresh.projectId)
    const model = getImageModel(project.imageModel)
    const chars = charactersOf(project.id).filter((c) => fresh.characterIds.includes(c.id))
    const refs = await referenceUrls(model, chars, ctx.signal)
    const prompt = clipPrompt(project, fresh, chars, refs.names, promptLimit(model))
    return {
      endpoint: model.id,
      body: imageBody(model, prompt, project.aspectRatio, refs.urls),
      payload: { target: 'clip-image', model: model.id, prompt }
    }
  })
}

export function generateCharacterSheet(characterId: string): Job {
  const existing = activeJobFor({ characterId }, 'sheet')
  if (existing) return existing
  const c = getCharacter(characterId)
  const gem = geminiImageModelOf(getProject(c.projectId).imageModel)
  if (gem) return startGeminiImage(insertJob({ projectId: c.projectId, characterId, kind: 'sheet', provider: 'gemini' }), 'sheet', gem)
  const job = insertJob({ projectId: c.projectId, characterId, kind: 'sheet', provider: 'higgsfield' })
  return startHiggsfield(job, async () => {
    const project = getProject(c.projectId)
    const model = getImageModel(project.imageModel)
    const prompt = sheetPrompt(project, getCharacter(characterId))
    return {
      endpoint: model.id,
      body: imageBody(model, prompt, '16:9', []),
      payload: { target: 'sheet', model: model.id, prompt }
    }
  })
}

export function generateClipVideo(clipId: string): Job {
  const existing = activeJobFor({ clipId }, 'video')
  if (existing) return existing
  const clip = getClip(clipId)
  if (!clip.imageAssetId) throw new Error('Buat gambar klip ini dulu sebelum membuat video AI.')
  const job = insertJob({ projectId: clip.projectId, clipId, kind: 'video', provider: 'higgsfield' })
  return startHiggsfield(job, async (ctx) => {
    const fresh = getClip(clipId)
    const image = getAsset(fresh.imageAssetId)
    if (!image) throw new Error('Gambar klip tidak ditemukan')
    const project = getProject(fresh.projectId)
    const model = getVideoModel(project.videoModel)
    ctx.progress(0.05, 'Menyiapkan gambar awal')
    const url = await publicUrlFor(image, ctx.signal)
    let prompt =
      fresh.videoPrompt.trim() ||
      `${splitAvoid(fresh.visualPrompt).scene.replace(/\.$/, '')}. Subtle natural motion of the characters and environment, the camera slowly pushes in. Keep the art style of the first frame.`
    if (model.input.mode === 'reference')
      prompt = `Open on the exact scene of the reference image and keep its art style, characters and composition. ${prompt}`
    return {
      endpoint: model.id,
      body: videoBody(model, prompt, url, fresh.durationMs / 1000, project.aspectRatio, project.videoResolution),
      payload: { target: 'clip-video', model: model.id, prompt }
    }
  })
}

export function generateClipTts(clipId: string): Job {
  const existing = activeJobFor({ clipId }, 'tts')
  if (existing) return existing
  const clip = getClip(clipId)
  const project = getProject(clip.projectId)
  const job = insertJob({ projectId: clip.projectId, clipId, kind: 'tts', provider: project.ttsProvider })
  emit.job(job)
  return runJob(job, 'tts', async (ctx) => {
    const fresh = getClip(clipId)
    const p = getProject(fresh.projectId)
    const text = fresh.narration.trim()
    if (!text) throw new Error('Naskah klip ini masih kosong')
    ctx.progress(0.2, 'Membuat suara')
    let rel: string
    let words: WordTiming[] | undefined
    let estimated = false
    const voice = p.ttsVoice || (p.ttsProvider === 'gemini' ? 'Charon' : p.ttsProvider === 'piper' ? 'auto' : '')
    let usedVoice = voice
    if (p.ttsProvider === 'piper') {
      const out = await piper.speak(text, voice, p.language, ctx.signal, (m) => ctx.progress(0.2, m))
      usedVoice = out.voice.id
      rel = saveFile(p.id, 'audio', '.wav', out.wav)
    } else if (p.ttsProvider === 'elevenlabs') {
      if (!voice) throw new Error('Pilih suara ElevenLabs dulu di langkah Ide cerita.')
      const out = await eleven.speak(text, voice, p.language, ctx.signal)
      rel = saveFile(p.id, 'audio', '.mp3', out.audio)
      words = out.words
    } else {
      const wav = await gemini.speak(text, voice, p.language, ctx.signal)
      rel = saveFile(p.id, 'audio', '.wav', wav)
    }
    ctx.progress(0.85, 'Mengukur durasi')
    const audioMs = await probeDurationMs(assetAbsPath(p.id, rel))
    if (!words?.length) {
      words = estimateWordTimings(stripVoiceTags(text), audioMs / 1000)
      estimated = true
    }
    const asset = insertAsset({
      projectId: p.id,
      clipId,
      kind: 'audio',
      provider: p.ttsProvider,
      model: p.ttsProvider === 'gemini' ? getSettings().geminiTtsModel : p.ttsProvider === 'piper' ? usedVoice : getSettings().elevenModel,
      prompt: text,
      localPath: rel,
      durationMs: audioMs,
      meta: { words, estimatedTimings: estimated, voice: usedVoice }
    })
    emit.asset(asset)
    const durationMs = Math.max(1500, audioMs + 400)
    const patch = { audioAssetId: asset.id, durationMs, voiceInMs: 0, voiceOutMs: null, voiceStartMs: 0 }
    patchClip(clipId, patch)
    emit.clip({ clipId, patch })
    touchProject(p.id)
    return asset.id
  })
}

export function generateMissingImages(projectId: string): Job[] {
  const jobs: Job[] = []
  const project = getProject(projectId)
  // Gemini takes the character sheets as reference images; Higgsfield only for models that accept references.
  if (geminiImageModelOf(project.imageModel) || maxRefs(getImageModel(project.imageModel)) > 0) {
    const needed = new Set(clipsOf(projectId).flatMap((c) => c.characterIds))
    for (const c of charactersOf(projectId)) {
      if (needed.has(c.id) && !c.sheetAssetId) jobs.push(generateCharacterSheet(c.id))
    }
  }
  for (const clip of clipsOf(projectId)) {
    if (!clip.imageAssetId) jobs.push(generateClipImage(clip.id))
  }
  return jobs
}

/** Turns every clip that has an image but no AI video yet into a video. */
export function generateMissingVideos(projectId: string): Job[] {
  const clips = clipsOf(projectId)
  if (clips.some((c) => !c.imageAssetId)) throw new Error('Buat gambar semua klip dulu sebelum menjadikannya video.')
  return clips.filter((c) => !c.videoAssetId).map((c) => generateClipVideo(c.id))
}

export function generateMissingTts(projectId: string): Job[] {
  return clipsOf(projectId)
    .filter((c) => !c.audioAssetId && c.narration.trim())
    .map((c) => generateClipTts(c.id))
}

/** After a restart, keep polling Higgsfield requests that were already submitted; fail the rest. */
export function resumeJobs(): void {
  for (const row of unfinishedJobs()) {
    const payload = JSON.parse(row.payload_json || '{}') as Partial<HfPayload>
    if (row.provider === 'higgsfield' && row.remote_id && payload.target) {
      const job = getJob(row.id)!
      runJob(job, 'higgsfield', (ctx) => finishHiggsfield(ctx, job, row.remote_id, payload as HfPayload))
    } else {
      emit.job(updateJob(row.id, { status: 'failed', error: 'Terhenti karena aplikasi ditutup. Coba lagi.', message: null }))
    }
  }
}

export async function setActiveAsset(clipId: string, assetId: string): Promise<void> {
  const asset = getAsset(assetId)
  if (!asset || asset.clipId !== clipId) throw new Error('Aset tidak cocok dengan klip ini')
  const patch: Partial<Clip> =
    asset.kind === 'image'
      ? { imageAssetId: asset.id }
      : asset.kind === 'video'
        ? { videoAssetId: asset.id, mediaInMs: 0 }
        : asset.kind === 'audio'
          ? { audioAssetId: asset.id, durationMs: Math.max(1500, (asset.durationMs ?? 0) + 400), voiceInMs: 0, voiceOutMs: null, voiceStartMs: 0 }
          : {}
  patchClip(clipId, patch)
  emit.clip({ clipId, patch })
}

/** Estimates that failed recently (no key, or a model the account cannot use), so pickers do not keep asking. */
const failedEstimates = new Map<string, number>()

/**
 * Credits for one image, or one clip video of about `seconds`. The model pickers ask for every model,
 * so answers are kept for a day and failures for ten minutes.
 */
export async function estimateCredits(
  kind: 'image' | 'video',
  modelId: string,
  aspect: AspectRatio,
  seconds = 5,
  resolution?: string | null
): Promise<CreditEstimate | null> {
  // Gemini is billed by Google, not in Higgsfield credits.
  if (kind === 'image' && geminiImageModelOf(modelId)) return null
  const model = kind === 'image' ? getImageModel(modelId) : getVideoModel(modelId)
  const body =
    kind === 'image'
      ? imageBody(model, 'estimate', aspect, [])
      : videoBody(model, 'estimate', 'https://example.com/frame.png', seconds, aspect, resolution)
  const key = `estimate:${model.id}:${JSON.stringify(body)}`
  const hit = readCache<CreditEstimate>(key)
  if (hit && Date.now() - hit.updatedAt < DAY) return hit.value
  const failedAt = failedEstimates.get(key)
  if (failedAt && Date.now() - failedAt < 10 * 60 * 1000) return null
  const value = await hf.estimate(model.id, body)
  if (value) writeCache(key, value)
  else failedEstimates.set(key, Date.now())
  return value
}

/** Prices can differ per account, so a new Higgsfield key starts from fresh estimates. */
export function forgetEstimates(): void {
  failedEstimates.clear()
  dropCache('estimate:')
}

// ---------- manual mode: make the picture or video in any other tool, then upload it ----------

export type ManualTarget = 'clip-image' | 'clip-video' | 'sheet'

export interface ManualMediaPrompt {
  prompt: string
  /** Format and length to choose in the other tool. */
  hint: string
  /** The clip's current picture, to use as the first frame of a video. */
  imageUrl: string | null
}

/** The same prompt the API would get, without reference images, for pasting into any image or video generator. */
export function manualMediaPrompt(target: ManualTarget, id: string): ManualMediaPrompt {
  if (target === 'sheet') {
    const c = getCharacter(id)
    const project = getProject(c.projectId)
    return { prompt: sheetPrompt(project, c), hint: 'Format 16:9 (lebar), satu gambar.', imageUrl: null }
  }
  const clip = getClip(id)
  const project = getProject(clip.projectId)
  if (target === 'clip-image') {
    const chars = charactersOf(project.id).filter((c) => clip.characterIds.includes(c.id))
    const sheets = chars.filter((c) => c.sheetAssetId).map((c) => c.name)
    return {
      prompt: clipPrompt(project, clip, chars, [], 100_000),
      hint:
        `Format ${project.aspectRatio}, satu gambar.` +
        (sheets.length ? ` Kalau tool-mu menerima gambar referensi, lampirkan lembar karakter: ${sheets.join(', ')}.` : ''),
      imageUrl: null
    }
  }
  const prompt =
    clip.videoPrompt.trim() ||
    `${splitAvoid(clip.visualPrompt).scene.replace(/\.$/, '')}. Subtle natural motion of the characters and environment, the camera slowly pushes in. Keep the art style of the first frame.`
  if (getStyle(project.styleId).flowPrompt) {
    const names = charactersOf(project.id).filter((c) => clip.characterIds.includes(c.id)).map((c, i) => `KAR${i + 1} ${c.name}`)
    const sec = Math.max(3, Math.round(clip.durationMs / 1000))
    const ref = names.length ? `Use the uploaded reference of ${names.join(', ')}; keep every character exactly like its reference.` : 'Keep the art style of the reference image.'
    return {
      prompt: [
        `Aspect ratio ${project.aspectRatio}. ${sec}-second single continuous shot, no cuts. ${ref}`,
        `ACTION: ${prompt}`,
        `SCENE: ${splitAvoid(clip.visualPrompt).scene}`,
        'LIGHTING: one key light from a single side; the face side toward the light is clean bright white and the other side has a soft gentle shadow (depth from shadow only, the face stays flat 2D line art); warm rim light on the lit edges, soft blue-purple shadows, sparkle glints on shiny details.',
        'CINEMATIC EFFECTS: visible particles or light effects (dust, embers, fireflies, light rays, bloom, lens glints), a blurred foreground object, background parallax. One smooth continuous camera move.',
        `NARRATION FOR TIMING ONLY: '${stripVoiceTags(clip.narration)}' (do not generate speech or on-screen text).`,
        'No text, no subtitles, no watermark, no extra characters. No background music.'
      ].join('\n'),
      hint: `Format Google Flow: ${project.aspectRatio}, ${sec} detik. Unggah lembar karakter sebagai referensi (KAR1, KAR2, …) dan pakai gambar klip sebagai frame pertama.`,
      imageUrl: clip.imageAssetId ? (getAsset(clip.imageAssetId)?.url ?? null) : null
    }
  }
  return {
    prompt: `${prompt} ${NO_MUSIC}`,
    hint: `Format ${project.aspectRatio}, durasi sekitar ${Math.max(3, Math.round(clip.durationMs / 1000))} detik, tanpa suara. Pakai gambar klip sebagai frame pertama.`,
    imageUrl: clip.imageAssetId ? (getAsset(clip.imageAssetId)?.url ?? null) : null
  }
}

const MANUAL_EXT: Record<ManualTarget, string[]> = {
  'clip-image': ['.png', '.jpg', '.jpeg', '.webp'],
  sheet: ['.png', '.jpg', '.jpeg', '.webp'],
  'clip-video': ['.mp4', '.mov', '.webm', '.m4v']
}

/** A file made outside the app becomes the clip's picture or video (or the character's sheet), like an API result. */
export async function importManualMedia(target: ManualTarget, id: string, fileName: string, data: Buffer): Promise<Asset> {
  const ext = /\.[a-z0-9]+$/i.exec(fileName)?.[0].toLowerCase() ?? ''
  if (!MANUAL_EXT[target].includes(ext))
    throw new Error(target === 'clip-video' ? 'Pakai file video MP4, MOV, atau WEBM.' : 'Pakai file gambar PNG, JPG, atau WEBP.')
  const clip = target === 'sheet' ? null : getClip(id)
  const character = target === 'sheet' ? getCharacter(id) : null
  const projectId = (clip ?? character)!.projectId
  const isVideo = target === 'clip-video'
  const rel = saveFile(projectId, isVideo ? 'videos' : 'images', ext, data)
  const abs = assetAbsPath(projectId, rel)
  const size = await probeSize(abs).catch(() => null)
  if (!size) throw new Error(isVideo ? 'Video tidak bisa dibaca. Coba ekspor ulang dari tool-nya sebagai MP4.' : 'Gambar tidak bisa dibaca. Pakai PNG, JPG, atau WEBP.')
  const durationMs = isVideo ? await probeDurationMs(abs).catch(() => null) : null
  const asset = insertAsset({
    projectId,
    clipId: clip?.id ?? null,
    characterId: character?.id ?? null,
    kind: isVideo ? 'video' : 'image',
    provider: 'manual',
    prompt: fileName,
    localPath: rel,
    durationMs,
    width: size.width,
    height: size.height
  })
  emit.asset(asset)
  attachAsset(target, projectId, clip?.id ?? null, character?.id ?? null, asset)
  return asset
}
