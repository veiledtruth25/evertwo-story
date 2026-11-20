/**
 * Voices for the local Piper TTS (https://github.com/rhasspy/piper). Each model is downloaded from the
 * `rhasspy/piper-voices` repo the first time a project uses it. Piper has no voice for Javanese, Sundanese
 * or Malay, so those languages cannot be voiced locally.
 */

export const PIPER_AUTO = 'auto'

export interface PiperVoice {
  id: string
  name: string
  language: string
  gender: 'pria' | 'wanita'
  description: string
  /** Folder in the voices repo, `<lang>/<locale>/<name>/<quality>`. */
  path: string
}

export const PIPER_VOICES: PiperVoice[] = [
  { id: 'id_ID-news_tts-medium', name: 'News TTS', language: 'id', gender: 'wanita', description: 'Indonesia, gaya pembawa berita', path: 'id/id_ID/news_tts/medium' },
  { id: 'en_US-ryan-medium', name: 'Ryan', language: 'en', gender: 'pria', description: 'Inggris AS, jelas dan hangat', path: 'en/en_US/ryan/medium' },
  { id: 'en_US-lessac-medium', name: 'Lessac', language: 'en', gender: 'wanita', description: 'Inggris AS, tenang dan rapi', path: 'en/en_US/lessac/medium' },
  { id: 'en_US-joe-medium', name: 'Joe', language: 'en', gender: 'pria', description: 'Inggris AS, santai', path: 'en/en_US/joe/medium' },
  { id: 'en_US-amy-medium', name: 'Amy', language: 'en', gender: 'wanita', description: 'Inggris AS, ceria', path: 'en/en_US/amy/medium' },
  { id: 'es_ES-davefx-medium', name: 'Davefx', language: 'es', gender: 'pria', description: 'Spanyol, netral', path: 'es/es_ES/davefx/medium' },
  { id: 'ar_JO-kareem-medium', name: 'Kareem', language: 'ar', gender: 'pria', description: 'Arab, netral', path: 'ar/ar_JO/kareem/medium' }
]

export const piperVoiceById = (id: string): PiperVoice | undefined => PIPER_VOICES.find((v) => v.id === id)

export const piperVoicesFor = (language: string): PiperVoice[] => PIPER_VOICES.filter((v) => v.language === language)

/** The voice used when a project leaves the voice on "Otomatis": the first voice of its language. */
export function pickPiperVoice(language: string, voice?: string): PiperVoice | null {
  const chosen = voice && voice !== PIPER_AUTO ? piperVoiceById(voice) : undefined
  return chosen ?? piperVoicesFor(language)[0] ?? null
}
