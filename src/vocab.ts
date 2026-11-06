// ============================================================
// vocab.ts — domain vocabulary for STT biasing.
//
// Terms come from VANI_VOCAB (comma-separated) and/or a vocab file (one term
// per line, # comments). Sent to Gnani Prisma as `keyterms` (v3.0) or
// `bias_list` (v2.5) so uncommon names and jargon are recognised correctly.
// Ported from the old faster_whisper_server.py loader.
// ============================================================

import * as fs from 'fs';

/** Gnani headers are not a place for an essay — keep the list short. */
const MAX_TERMS = 50;

export function loadVocabTerms(env: NodeJS.ProcessEnv = process.env): string[] {
  const terms: string[] = (env.VANI_VOCAB ?? '').split(',');

  const file = env.VANI_VOCAB_FILE ?? 'vocab.txt';
  if (file && fs.existsSync(file)) {
    try {
      for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        terms.push(line.split('#', 1)[0]);
      }
    } catch (err) {
      console.warn(`[vocab] could not read ${file}: ${(err as Error).message}`);
    }
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of terms) {
    const t = raw.trim();
    // Header values must be single-line printable text.
    if (!t || /[\r\n]/.test(t)) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(t);
  }
  return unique.slice(0, MAX_TERMS);
}
