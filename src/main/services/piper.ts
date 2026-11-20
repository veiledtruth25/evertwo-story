import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { once } from 'node:events'
import { join } from 'node:path'
import { pickPiperVoice, PIPER_AUTO, PIPER_VOICES, type PiperVoice } from '@shared/piperVoices'
import type { VoiceOption } from '@shared/types'
import { dataDir, resourcesDir } from '../paths'

const REPO = 'https://huggingface.co/rhasspy/piper-voices/resolve/main'

function binPath(): string {
  // The Docker image unpacks Piper into /opt/piper and points PIPER_BIN at it.
  return process.env.PIPER_BIN || join(resourcesDir(), 'piper', 'piper')
}

function voiceDir(): string {
  const dir = join(dataDir(), 'models', 'piper')
  mkdirSync(dir, { recursive: true })
  return dir
}

const modelFile = (v: PiperVoice): string => join(voiceDir(), `${v.id}.onnx`)
const configFile = (v: PiperVoice): string => `${modelFile(v)}.json`

export const voiceReady = (v: PiperVoice): boolean => existsSync(modelFile(v)) && existsSync(configFile(v))

/** The voice list for the picker: "Otomatis" first, then every voice with whether it is downloaded yet. */
export function listVoices(language?: string): VoiceOption[] {
  const auto = pickPiperVoice(language ?? 'id')
  const list: VoiceOption[] = [
    {
      id: PIPER_AUTO,
      name: 'Otomatis',
      description: auto ? `Dipilihkan sesuai bahasa proyek (sekarang: ${auto.name}, ${auto.gender})` : 'Bahasa ini belum punya suara Piper'
    }
  ]
  for (const v of PIPER_VOICES) {
    list.push({ id: v.id, name: `${v.name} (${v.gender})`, description: `${v.description} · ${voiceReady(v) ? 'sudah diunduh' : 'diunduh saat pertama dipakai, ±60 MB'}` })
  }
  return list
}

const downloads = new Map<string, Promise<void>>()

async function fetchTo(url: string, dest: string, signal: AbortSignal, onBytes?: (n: number) => void): Promise<void> {
  const part = `${dest}.part`
  rmSync(part, { force: true })
  const res = await fetch(url, { signal })
  if (!res.ok || !res.body) throw new Error(`Unduhan suara gagal (HTTP ${res.status})`)
  const out = createWriteStream(part)
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      if (!out.write(chunk)) await once(out, 'drain')
      onBytes?.(chunk.length)
    }
  } finally {
    out.end()
    await once(out, 'close')
  }
  renameSync(part, dest)
}

/** Downloads a voice model once, even when several jobs ask at the same time. */
export function ensureVoice(v: PiperVoice, signal: AbortSignal, progress?: (message: string) => void): Promise<void> {
  if (voiceReady(v)) return Promise.resolve()
  let job = downloads.get(v.id)
  if (!job) {
    job = (async () => {
      const base = `${REPO}/${v.path}/${v.id}`
      let got = 0
      // Not tied to one job's signal: another job may be waiting on the same download.
      const ctrl = new AbortController()
      await fetchTo(`${base}.onnx.json`, configFile(v), ctrl.signal)
      await fetchTo(`${base}.onnx`, modelFile(v), ctrl.signal, (n) => {
        got += n
        progress?.(`Mengunduh suara ${v.name} (${Math.round(got / 1_000_000)} MB)`)
      })
    })().finally(() => downloads.delete(v.id))
    downloads.set(v.id, job)
  }
  return Promise.race([
    job,
    new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new Error('Dibatalkan')), { once: true }))
  ])
}

/** Piper reads one utterance per line and pauses between them, so pause tags become line breaks. */
export function toPiperText(text: string): string {
  return text
    .replace(/<(?:short|long) pause>/gi, '\n')
    .replace(/<[^>]*>|\[[^\]]*\]/g, ' ')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/** Voices `text` and returns a WAV file. Downloads the voice model first when it is missing. */
export async function speak(text: string, voiceId: string, language: string, signal: AbortSignal, progress?: (message: string) => void): Promise<{ wav: Buffer; voice: PiperVoice }> {
  const voice = pickPiperVoice(language, voiceId)
  if (!voice) throw new Error('Piper belum punya suara untuk bahasa ini. Pilih Gemini atau ElevenLabs.')
  const input = toPiperText(text)
  if (!input) throw new Error('Tidak ada teks yang bisa disuarakan.')
  await ensureVoice(voice, signal, progress)
  const out = join(dataDir(), 'tmp', `piper-${randomUUID()}.wav`)
  mkdirSync(join(dataDir(), 'tmp'), { recursive: true })
  try {
    await new Promise<void>((resolve, reject) => {
      const p = spawn(binPath(), ['--model', modelFile(voice), '--config', configFile(voice), '--output_file', out, '--sentence_silence', '0.35'], { stdio: ['pipe', 'ignore', 'pipe'] })
      let err = ''
      p.stderr.on('data', (d) => (err = (err + d).slice(-600)))
      p.on('error', (e) => reject(new Error(`Piper tidak bisa dijalankan: ${e.message}`)))
      p.on('close', (code) => {
        if (signal.aborted) return reject(new Error('Dibatalkan'))
        if (code !== 0) return reject(new Error(`Piper gagal (kode ${code}): ${err.split('\n').slice(-2).join(' ').trim()}`))
        resolve()
      })
      signal.addEventListener('abort', () => p.kill('SIGKILL'), { once: true })
      p.stdin.end(input + '\n')
    })
    if (!existsSync(out) || statSync(out).size < 100) throw new Error('Piper tidak menghasilkan suara.')
    return { wav: readFileSync(out), voice }
  } finally {
    rmSync(out, { force: true })
  }
}
