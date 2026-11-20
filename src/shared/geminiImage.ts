/**
 * Gemini image models sit next to the Higgsfield ones in the same `imageModel` field, as "gemini:<model id>".
 * Anything else is a Higgsfield endpoint id.
 */
const PREFIX = 'gemini:'

export const geminiImageModelOf = (id: string | null | undefined): string | null => (id && id.startsWith(PREFIX) ? id.slice(PREFIX.length) || null : null)
export const geminiImageId = (model: string): string => `${PREFIX}${model}`

/** Used until the live model list arrives, or when the key cannot list models. */
export const GEMINI_IMAGE_FALLBACK = 'gemini-2.5-flash-image'

/** Reference images (character sheets) sent with one Gemini image request. */
export const GEMINI_MAX_REFS = 4
