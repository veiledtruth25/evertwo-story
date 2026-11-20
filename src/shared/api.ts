import type {
  ApiProvider,
  AspectRatio,
  AppSettings,
  Asset,
  CharacterPatchEvent,
  ClipPatchEvent,
  CreditEstimate,
  WhisperStatus,
  WordTiming,
  ExportOptions,
  Job,
  KeyStatus,
  KeyTestResult,
  ModelList,
  ModelSource,
  MusicPrompt,
  NewProjectInput,
  ProjectBundle,
  ProjectSnapshot,
  ProjectSummary,
  TrendingIdeas,
  TtsProvider,
  VoiceOption
} from './types'

/** The typed surface the browser gets as `window.api` (src/renderer/src/lib/webApi.ts calls the server over HTTP). */
export interface StudioApi {
  projects: {
    list(): Promise<ProjectSummary[]>
    create(input: NewProjectInput): Promise<ProjectBundle>
    get(id: string): Promise<ProjectBundle>
    save(snapshot: ProjectSnapshot): Promise<{ updatedAt: number }>
    remove(id: string): Promise<void>
    duplicate(id: string): Promise<ProjectSummary>
  }
  story: {
    /** Idea → scene-by-scene script (story and voice-over). */
    script(projectId: string): Promise<ProjectBundle>
    /** Script → one image plan per scene; "missing" skips scenes whose plan still matches their story. */
    visuals(projectId: string, mode: 'missing' | 'all'): Promise<ProjectBundle>
    /** A background-music prompt that fits the finished script, for use in Suno or another music AI. */
    musicPrompt(projectId: string): Promise<MusicPrompt>
    /** Manual mode without an API key: the full prompt to paste into any online AI that replies with JSON. */
    manualPrompt(projectId: string, kind: 'script' | 'visuals', mode: 'missing' | 'all'): Promise<string>
    /** Applies the JSON reply pasted back from that AI, like an API result. */
    manualApply(projectId: string, kind: 'script' | 'visuals', mode: 'missing' | 'all', reply: string): Promise<ProjectBundle>
  }
  generate: {
    clipImage(clipId: string): Promise<Job>
    clipVideo(clipId: string): Promise<Job>
    clipTts(clipId: string): Promise<Job>
    characterSheet(characterId: string): Promise<Job>
    missingImages(projectId: string): Promise<Job[]>
    /** An AI video for every clip that has an image but no video yet. */
    missingVideos(projectId: string): Promise<Job[]>
    missingTts(projectId: string): Promise<Job[]>
    /** Voices scenes in one continuous take and cuts it per scene: those without a voice, or all of them. */
    narration(projectId: string, mode: 'missing' | 'all'): Promise<Job>
    /** Re-times caption words of voiced scenes against the audio with the local Whisper model. */
    syncCaptions(projectId: string, mode?: 'stale' | 'all'): Promise<Job>
    cancel(jobId: string): Promise<void>
    /** The prompt for making a clip picture, a clip video or a character sheet in another tool (no API call). */
    manualPrompt(target: 'clip-image' | 'clip-video' | 'sheet', id: string): Promise<{ prompt: string; hint: string; imageUrl: string | null }>
    /** Credits for one image, or one video of about `seconds`, with this model. Null without a working key. */
    estimate(kind: 'image' | 'video', modelId: string, aspect: AspectRatio, seconds?: number, resolution?: string | null): Promise<CreditEstimate | null>
  }
  clips: {
    /** Splits a clip at `atMs` into two clips (picture, voice and narration divided at the nearest pause). */
    split(clipId: string, atMs: number): Promise<ProjectBundle>
    /** Takes the voice off a clip. */
    detachVoice(clipId: string): Promise<void>
  }
  assets: {
    setActive(clipId: string, assetId: string): Promise<void>
    /** Caption words of a voice clip, after the text was fixed by hand. */
    setWords(assetId: string, words: WordTiming[]): Promise<Asset>
    /** Uploads a music file from the browser and adds it to the project. */
    uploadMusic(projectId: string, file: File): Promise<Asset>
    /** Uploads a logo or watermark image for an overlay. */
    uploadImage(projectId: string, file: File): Promise<Asset>
    /** Uploads a picture, video or character sheet made in another tool and attaches it. */
    uploadMedia(target: 'clip-image' | 'clip-video' | 'sheet', id: string, file: File): Promise<Asset>
  }
  settings: {
    get(): Promise<AppSettings>
    set(patch: Partial<AppSettings>): Promise<AppSettings>
    keys(): Promise<KeyStatus[]>
    setKey(provider: ApiProvider, key: string): Promise<KeyTestResult>
    /** Saves an OpenAI-compatible endpoint; the key is optional for local servers. */
    setCustom(baseUrl: string, key: string): Promise<KeyTestResult>
    clearKey(provider: ApiProvider): Promise<void>
    /** The full stored key, only for the "show key" button. */
    revealKey(provider: ApiProvider): Promise<string | null>
    testKey(provider: ApiProvider): Promise<KeyTestResult>
    voices(provider: TtsProvider, language?: string): Promise<VoiceOption[]>
  }
  ideas: {
    /** Video ideas from today's trending searches (cached for an hour unless `refresh`). */
    trending(language: string, refresh?: boolean): Promise<TrendingIdeas>
    /** A prompt for an online chat AI, for when the app's own model cannot make ideas. */
    manualPrompt(language: string): Promise<string>
    /** Saves the JSON reply of that chat AI as the idea pool. */
    manualApply(language: string, reply: string): Promise<TrendingIdeas>
  }
  models: {
    /** Live model list from the provider. Served from cache unless `refresh` is set or the cache is stale. */
    list(source: ModelSource, refresh?: boolean): Promise<ModelList>
  }
  exporter: {
    start(projectId: string, options: ExportOptions): Promise<Job>
    /** Download address of a finished export; `path` is the job message the server returned. */
    downloadUrl(path: string): string
  }
  app: {
    openExternal(url: string): Promise<void>
    copyText(text: string): Promise<void>
    version(): Promise<string>
  }
  whisper: {
    status(): Promise<WhisperStatus>
    download(): Promise<void>
    cancel(): Promise<void>
    remove(): Promise<void>
  }
  on: {
    whisper(cb: (status: WhisperStatus) => void): () => void
    job(cb: (job: Job) => void): () => void
    clip(cb: (e: ClipPatchEvent) => void): () => void
    character(cb: (e: CharacterPatchEvent) => void): () => void
    asset(cb: (asset: Asset) => void): () => void
  }
}

export const EVENTS = {
  job: 'event:job',
  clip: 'event:clip',
  character: 'event:character',
  asset: 'event:asset',
  whisper: 'event:whisper'
} as const
