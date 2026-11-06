// ============================================================
// ttsUtils.ts — Text sanitization before TTS
// Strips anything that must never be spoken aloud: URLs, markdown,
// citation refs, HTML, emoji. Teachers like **bold**; the voice must
// not read asterisks.
// ============================================================

/**
 * The replacements, without trimming. Safe on streamed LLM chunks: a chunk's
 * leading/trailing space is the gap between two words and must survive, or
 * "first law" + " states" becomes "lawstates".
 */
export function sanitizeTtsChunk(text: string): string {
  return text
    // 1. Markdown links: [display text](url) → "display text"
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // 2. Bare URLs (http/https)
    .replace(/https?:\/\/[^\s)>"]+/g, '')
    // 3. Citation / reference brackets: [1], [2,3], [1, 2, 3]
    .replace(/\[\d+(?:,\s*\d+)*\]/g, '')
    // 4. HTML tags
    .replace(/<[^>]*>/g, '')
    // 5. Markdown emphasis / headings / code marks
    .replace(/[*_`#~]+/g, '')
    // 6. Emoji and pictographs (and the variation selector that follows them)
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    // 7. Collapse runs of spaces left by removals (newlines are kept: they are
    //    sentence boundaries for the sentence buffer)
    .replace(/[ \t]{2,}/g, ' ');
}

/** Full sanitization for a complete sentence or text: replacements + trim. */
export function sanitizeForTTS(text: string): string {
  return sanitizeTtsChunk(text).replace(/\s{2,}/g, ' ').trim();
}
