/**
 * Repairs the usual slips of chat AIs in JSON, without changing what the text says: curly double quotes used as
 * JSON quotes, trailing commas, // and /* *\/ comments, raw line breaks inside strings, and invisible spaces.
 */
function repairJson(src: string): string {
  const text = src.replace(/[​-‍⁠﻿]/g, '').replace(/ /g, ' ')
  let out = ''
  let inStr = false
  let smart = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (c === '\\') {
        out += c + (text[i + 1] ?? '')
        i++
      } else if (c === '"' || (smart && (c === '”' || c === '“'))) {
        inStr = false
        out += '"'
      } else if (c === '\n') out += '\\n'
      else if (c === '\r') continue
      else if (c === '\t') out += '\\t'
      else out += c
      continue
    }
    if (c === '"' || c === '“' || c === '”') {
      inStr = true
      smart = c !== '"'
      out += '"'
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? text.length : end + 1
    } else if (c === ',') {
      // A comma is a trailing one when only spaces and comments separate it from the closing bracket.
      let j = i + 1
      for (;;) {
        while (j < text.length && /\s/.test(text[j])) j++
        if (text[j] === '/' && text[j + 1] === '/') while (j < text.length && text[j] !== '\n') j++
        else if (text[j] === '/' && text[j + 1] === '*') {
          const end = text.indexOf('*/', j + 2)
          j = end < 0 ? text.length : end + 2
        } else break
      }
      if (text[j] !== '}' && text[j] !== ']') out += c
    } else out += c
  }
  return out
}

function parseLoose(candidate: string): unknown {
  try {
    return JSON.parse(candidate)
  } catch {
    return JSON.parse(repairJson(candidate))
  }
}

/** Where JSON.parse stopped, with a few characters around it, so the user can see what is wrong in the reply. */
function describe(err: unknown, candidate: string): string {
  const msg = (err as Error)?.message ?? ''
  const m = /position (\d+)/i.exec(msg)
  if (!m) return msg.slice(0, 160)
  const at = Number(m[1])
  const around = candidate.slice(Math.max(0, at - 30), at + 30).replace(/\s+/g, ' ')
  return `${msg.slice(0, 120)} (sekitar: …${around}…)`
}

/** Pulls a JSON object out of a model reply that may contain think tags, code fences or prose. */
export function extractJson(text: string): unknown {
  const t = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const candidates: string[] = []
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t)
  if (fence) candidates.push(fence[1].trim())
  candidates.push(t)
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) candidates.push(t.slice(start, end + 1))

  let last: { err: unknown; candidate: string } | null = null
  for (const c of candidates) {
    try {
      const v = parseLoose(c)
      if (v && typeof v === 'object') return v
    } catch (err) {
      last = { err, candidate: c }
    }
  }
  if (last) throw new Error(`Balasan model bukan JSON yang valid: ${describe(last.err, last.candidate)}`)
  throw new Error('Balasan model bukan JSON')
}
