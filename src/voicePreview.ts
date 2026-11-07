// ============================================================
// voicePreview.ts — a short spoken sample of a Timbre voice in a given
// language, so the student can hear a voice before choosing it.
//
// Uses the Timbre REST endpoint (one WAV per request) — independent of the
// live TTS socket, so previews work before a session starts and never
// interleave with a lesson's audio. Samples are cached in memory and on disk
// (data/voice-previews/) since the same few dozen are requested repeatedly.
// ============================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { LanguageConfig } from './languages';
import { ttsModel } from './voices';
import { synthesizeWav } from './gnaniTtsRest';

const CACHE_DIR = process.env.VOICE_PREVIEW_DIR ?? path.join('data', 'voice-previews');
const memory = new Map<string, Buffer>();
const inFlight = new Map<string, Promise<Buffer>>();

export class PreviewError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function previewText(lang: LanguageConfig, voice: string): string {
  return lang.sampleSentence.replace('{voice}', voice);
}

export async function getVoicePreview(voice: string, lang: LanguageConfig): Promise<Buffer> {
  const model = ttsModel();
  const text = previewText(lang, voice);
  const key = crypto.createHash('sha1').update(`${model}|${voice}|${lang.ttsLanguage}|${text}`).digest('hex');

  const cached = memory.get(key);
  if (cached) return cached;

  const file = path.join(CACHE_DIR, `${key}.wav`);
  if (fs.existsSync(file)) {
    const buf = fs.readFileSync(file);
    memory.set(key, buf);
    return buf;
  }

  // Many clicks on the same card while the first request is out: one request.
  const pending = inFlight.get(key);
  if (pending) return pending;

  const job = synthesize(text, voice, model, lang.ttsLanguage)
    .then((wav) => {
      memory.set(key, wav);
      try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(file, wav);
      } catch (err) {
        console.warn(`[voice-preview] could not cache ${file}: ${(err as Error).message}`);
      }
      return wav;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

async function synthesize(text: string, voice: string, model: string, language: string): Promise<Buffer> {
  try {
    const wav = await synthesizeWav({ text, voice, model, language });
    console.log(`[voice-preview] synthesized ${voice} / ${language} (${wav.length} bytes)`);
    return wav;
  } catch (err) {
    const e = err as Error & { status?: number };
    console.error(`[voice-preview] ${voice}/${language}: ${e.message}`);
    throw new PreviewError(e.message, e.status ?? 502);
  }
}
