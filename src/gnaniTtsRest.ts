// ============================================================
// gnaniTtsRest.ts — one-shot Timbre synthesis over REST.
//
//   POST https://api.vachana.ai/api/v1/tts/inference   (header X-API-Key-ID)
//   → one WAV (linear PCM, 22050 Hz mono)
//
// Used for voice previews, and as the second chance for a lesson sentence the
// realtime socket failed to speak (error, stall, or a socket closed mid-audio),
// so a sentence is never silently skipped.
// ============================================================

export class TtsRestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface RestTtsRequest {
  text: string;
  voice: string;
  model: string;
  language: string;
  speed?: number;
  timeoutMs?: number;
}

/** Synthesise `text` and return the WAV file Timbre sends back. */
export async function synthesizeWav(req: RestTtsRequest): Promise<Buffer> {
  const apiKey = (process.env.GNANI_API_KEY ?? '').trim();
  if (!apiKey) throw new TtsRestError('GNANI_API_KEY is not set on the server', 503);

  const url = process.env.GNANI_TTS_REST_URL ?? 'https://api.vachana.ai/api/v1/tts/inference';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key-ID': apiKey },
    body: JSON.stringify({
      text: req.text,
      voice: req.voice,
      model: req.model,
      language: req.language,
      speed: req.speed ?? 1.0,
      audio_config: { sample_rate: 22050, num_channels: 1, sample_width: 2, encoding: 'linear_pcm', container: 'wav' },
    }),
    signal: AbortSignal.timeout(req.timeoutMs ?? 20_000),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const detail = (body.detail as Record<string, unknown> | undefined)?.message ?? body.message ?? res.statusText;
    throw new TtsRestError(`Gnani TTS error (HTTP ${res.status}): ${String(detail)}`, 502);
  }
  const wav = Buffer.from(await res.arrayBuffer());
  // Never pass on something that is not playable audio (an error page, an empty body).
  if (wav.length <= 44 || wav.toString('ascii', 0, 4) !== 'RIFF') {
    throw new TtsRestError(`Gnani TTS returned no audio (${wav.length} bytes)`, 502);
  }
  return wav;
}
