import { LANGUAGES } from '@shared/models'
import type { TrendingIdeas } from '@shared/types'
import { readCache, writeCache } from '../settings'
import { extractJson } from './json'
import { generateJson } from './llm'

/** Google Trends region per app language; languages without a clear region fall back to Indonesia. */
const GEO: Record<string, string> = { id: 'ID', en: 'US', ms: 'MY', jv: 'ID', su: 'ID', es: 'ES', ar: 'SA' }
const TTL = 60 * 60 * 1000
const LLM_WAIT = 25_000

/** The home page should not hang when the model is busy (Gemini retries for minutes on a 503). */
const within = <T>(p: Promise<T>): Promise<T> =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('model terlalu lama menjawab')), LLM_WAIT))])

interface Trend {
  title: string
  traffic: string
  headline: string
}

const unxml = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim()

const tag = (xml: string, name: string): string => unxml(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml)?.[1] ?? '')

/** Today's rising searches from the public Google Trends feed (no key needed). */
async function fetchTrends(geo: string): Promise<Trend[]> {
  const res = await fetch(`https://trends.google.com/trending/rss?geo=${geo}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`Google Trends tidak bisa dibuka (HTTP ${res.status}).`)
  const xml = await res.text()
  const items = xml.split('<item>').slice(1)
  const out = items
    .map((it) => ({ title: tag(it, 'title'), traffic: tag(it, 'ht:approx_traffic'), headline: tag(it, 'ht:news_item_title') }))
    .filter((t) => t.title)
  if (!out.length) throw new Error('Google Trends tidak mengirim topik.')
  return out.slice(0, 25)
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          trend: { type: 'string', description: 'The trending search this idea is based on, copied exactly.' },
          idea: { type: 'string', description: 'The video idea: one sentence in the target language, a clear topic or question an explainer can answer.' }
        },
        required: ['trend', 'idea']
      }
    }
  },
  required: ['ideas']
}

const SYSTEM =
  'You pick topics for short YouTube explainer videos. Choose topics that can become an educational or curiosity-driven video (how it works, why it happens, history, background, what to know). Skip weather reports, live sports scores, gambling, lotteries, adult content, personal tragedies, and gossip about private people. Never invent facts about the news; frame each idea as a question or background topic.'

type Plan = { ideas: { trend: string; idea: string }[] }

const clean = (plan: Plan): TrendingIdeas['ideas'] =>
  (plan.ideas ?? []).map((i) => ({ trend: String(i.trend ?? '').trim(), idea: String(i.idea ?? '').trim() })).filter((i) => i.idea)

/** The system text and prompt for an idea request; `trends` is null when Google Trends could not be reached. */
async function ideasRequest(language: string): Promise<{ system: string; prompt: string; trends: Trend[] | null }> {
  const lang = LANGUAGES.find((l) => l.code === language)?.english ?? 'Indonesian'
  let trends: Trend[] | null = null
  try {
    trends = await fetchTrends(GEO[language] ?? 'ID')
  } catch (e) {
    console.warn('[trends]', (e as Error).message)
  }
  if (trends) {
    const list = trends.map((t, i) => `${i + 1}. ${t.title}${t.traffic ? ` (${t.traffic} searches)` : ''}${t.headline ? ` — news: ${t.headline}` : ''}`).join('\n')
    return {
      system: SYSTEM,
      prompt: `Today's trending searches:\n${list}\n\nWrite 8 video ideas in ${lang}, each based on a different trending search. Each idea is one sentence.`,
      trends
    }
  }
  return {
    system: SYSTEM,
    prompt: `Invent 8 varied, surprising video ideas in ${lang} across different fields (science, history, nature, technology, daily life, money, health). Each idea is one sentence. Set "trend" to the field. Random seed: ${Math.random().toString(36).slice(2)}.`,
    trends: null
  }
}

/**
 * A pool of video ideas for the home page, which shows a random few. Built from today's trending searches
 * rewritten by the LLM, or invented by the LLM when Google Trends cannot be reached. Cached for an hour.
 */
export async function trendingIdeas(language: string, refresh = false): Promise<TrendingIdeas> {
  const key = `trends:${language}`
  const cached = refresh ? null : readCache<TrendingIdeas>(key)
  if (cached && Date.now() - cached.updatedAt < TTL) return cached.value
  const req = await ideasRequest(language)
  let result: TrendingIdeas | null = null
  try {
    const ideas = clean(await within(generateJson<Plan>({ system: req.system, prompt: req.prompt, schema: SCHEMA, name: 'ideas' })))
    if (ideas.length) result = { source: req.trends ? 'ai' : 'random', ideas: ideas.slice(0, 10), fetchedAt: Date.now() }
  } catch (e) {
    console.warn('[trends] LLM tidak dipakai:', (e as Error).message)
  }
  // Raw trending searches are not ideas (names of people, weather), so without the LLM there is nothing to show.
  if (!result) throw new Error('Belum bisa membuat ide: model penyusun cerita sedang sibuk atau belum diatur. Coba lagi sebentar.')
  writeCache(key, result)
  return result
}

/** One text for a chat AI (ChatGPT, Gemini, Claude) that asks for the same JSON the LLM would return. */
export async function manualIdeasPrompt(language: string): Promise<string> {
  const req = await ideasRequest(language)
  const search = req.trends ? '' : '\nIf you can browse the web, base the ideas on what is trending today; otherwise invent them.'
  return [
    req.system,
    req.prompt + search,
    `Reply with ONE JSON object only (no markdown, no commentary) that matches this JSON Schema:\n${JSON.stringify(SCHEMA, null, 2)}`
  ].join('\n\n')
}

/** Saves the JSON a chat AI wrote for `manualIdeasPrompt` as the idea pool. */
export function applyManualIdeas(language: string, reply: string): TrendingIdeas {
  if (!reply.trim()) throw new Error('Tempel dulu balasan dari AI.')
  let plan: unknown
  try {
    plan = extractJson(reply)
  } catch (e) {
    const detail = (e as Error).message.replace(/^Balasan model bukan JSON( yang valid)?:?\s*/, '')
    throw new Error(`Balasannya belum berupa JSON yang utuh${detail ? ` (${detail})` : ''}. Salin seluruh balasan AI dari tanda { sampai }, atau minta AI mengulang.`)
  }
  const ideas = clean((plan ?? {}) as Plan)
  if (!ideas.length) throw new Error('Balasannya tidak berisi daftar "ideas".')
  const result: TrendingIdeas = { source: 'ai', ideas: ideas.slice(0, 10), fetchedAt: Date.now() }
  writeCache(`trends:${language}`, result)
  return result
}
