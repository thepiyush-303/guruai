// ============================================================
// gnaniTts.ts — Gnani Timbre text-to-speech over the realtime WebSocket.
// Replaces the local Piper subprocess.
//
//   wss://api.vachana.ai/api/v1/tts   (header X-API-Key-ID)
//   in:  one JSON request {text, voice, model, language, speed, audio_config}
//   out: start | audio {data.audio: base64} | complete | error
//
// The docs allow ONE request in flight per connection, so sentences go through
// a serial FIFO: the next is sent when the previous `complete`s. Timbre returns
// audio faster than real time, so sentence N+1 is synthesised while the browser
// is still playing sentence N — the pipeline stays full without extra sockets.
//
// We ask for container=raw, pcm_s16le @ 22050 Hz: byte-identical to Piper's
// output, so the browser player and the [0xAF][0xFE][seq] framing are unchanged.
// ============================================================

import WebSocket from 'ws';
import { LanguageConfig, LANGUAGES } from './languages';
import { TtsFramer, stripWavHeader } from './ttsFraming';
import { defaultVoice, ttsModel } from './voices';
import { synthesizeWav } from './gnaniTtsRest';

export const TTS_SAMPLE_RATE = 22050;

export interface GnaniTtsOptions {
  url: string;
  apiKey: string;
  model: string;
  voice: string;
  speed: number;
  /**
   * A request is abandoned after this long WITHOUT any message from Gnani.
   * An inactivity limit, not a total one: Timbre streams long sentences at
   * roughly speaking pace, so a total cap cut the ends off long answers.
   */
  requestTimeoutMs?: number;
  reconnectDelayMs?: number;
  framer?: TtsFramer;
  /**
   * Second chance for a sentence the socket failed to speak: returns a WAV
   * (or raw PCM) for the text. Defaults to Timbre REST; tests inject a mock.
   */
  fallback?: ((req: { text: string; voice: string; model: string; language: string; speed: number }) => Promise<Buffer>) | null;
}

/** How one run of speech (first queued sentence → queue drained) went. */
export interface TtsRunStats {
  spoken: number;
  failed: number;
}

interface Job {
  id: number;
  text: string;
  retried: boolean;
  sentAt: number;
  gotAudio: boolean;
  /** First sentence of a turn — logs time-to-first-audio. */
  firstOfTurn: boolean;
  /** PCM bytes already sent to the browser for this sentence. */
  bytesSent: number;
  /** The REST fallback was already tried. */
  restTried: boolean;
  /** Being retried over REST right now: the socket's messages no longer apply to it. */
  viaRest: boolean;
  /** Produced by splitting a failed sentence: not split again. */
  isSplit: boolean;
}

/** A failed sentence longer than this is split in two for a last try. */
const SPLIT_MIN_CHARS = 40;

export class GnaniTtsClient {
  private opts: Required<Omit<GnaniTtsOptions, 'framer' | 'fallback'>>;
  private fallback: GnaniTtsOptions['fallback'];
  private framer: TtsFramer;
  private ws: WebSocket | null = null;
  private open = false;
  private lang: LanguageConfig = LANGUAGES.en;
  private queue: Job[] = [];
  private inFlight: Job | null = null;
  private nextId = 1;
  private turnStartPending = false;
  private requestTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private warnedNoKey = false;
  /** True from the first queued sentence until the queue drains. */
  private active = false;
  private activityCb: ((active: boolean, stats?: TtsRunStats) => void) | null = null;
  private spokenThisRun = 0;
  private failedThisRun: string[] = [];
  /**
   * Timbre ends every request with TWO `complete` messages: the end of the
   * audio ({data: {is_final: true}}), then a request summary ({message:
   * "Streaming completed"}). We move on at the first; the summary that
   * follows must not be mistaken for the end of the NEXT sentence — that
   * shifted every later sentence by one and dropped the end of long answers.
   */
  private pendingSummaries = 0;
  /** Audio that arrived with no request in flight (should stay 0). */
  private strayAudioBytes = 0;

  constructor(opts: GnaniTtsOptions) {
    this.opts = {
      requestTimeoutMs: 12_000,
      reconnectDelayMs: 500,
      ...opts,
    };
    this.framer = opts.framer ?? new TtsFramer();
    this.fallback = opts.fallback === undefined ? (req) => synthesizeWav(req) : opts.fallback;
  }

  get hasKey(): boolean {
    return this.opts.apiKey.length > 0;
  }

  /**
   * Notified when speech output starts (first sentence queued) and when it is
   * finished (queue drained or cancelled). The client keeps its mic closed in
   * between, including the gaps between sentences.
   */
  onActivity(cb: (active: boolean, stats?: TtsRunStats) => void): void {
    this.activityCb = cb;
  }

  /** Speech is queued or being synthesised right now. */
  get isActive(): boolean {
    return this.active;
  }

  private setActive(active: boolean, cancelled = false): void {
    if (this.active === active) return;
    this.active = active;
    if (active) {
      this.spokenThisRun = 0;
      this.failedThisRun = [];
      this.activityCb?.(true);
      return;
    }
    if (cancelled) {
      console.log(`[gnani-tts] speech cancelled after ${this.spokenThisRun} sentence(s)`);
    } else {
      const total = this.spokenThisRun + this.failedThisRun.length;
      console.log(
        `[gnani-tts] queue drained — spoken ${this.spokenThisRun}/${total}` +
          (this.failedThisRun.length ? `, failed [${this.failedThisRun.join('; ')}]` : '') +
          (this.strayAudioBytes ? `, ${(this.strayAudioBytes / 2 / TTS_SAMPLE_RATE).toFixed(1)}s of stray audio dropped` : ''),
      );
    }
    this.strayAudioBytes = 0;
    this.activityCb?.(false, { spoken: this.spokenThisRun, failed: this.failedThisRun.length });
  }

  get voice(): string {
    return this.opts.voice;
  }

  /** Language and voice are per-request fields, so no reconnect is needed. */
  configure(lang: LanguageConfig, voice?: string): void {
    this.lang = lang;
    if (voice) this.opts.voice = voice;
  }

  /** Warm the connection so the first sentence does not pay the TLS handshake. */
  start(): void {
    this.stopped = false;
    if (!this.hasKey) {
      this.warnNoKey();
      return;
    }
    this.connect();
  }

  /** Next synthesize() is the first sentence of a new reply (latency logging). */
  beginTurn(): void {
    this.turnStartPending = true;
  }

  /** Queue one sentence; its audio is streamed to `clientWs` as binary frames. */
  synthesize(text: string, clientWs: WebSocket): void {
    const clean = text.trim();
    if (!clean) return;
    if (!this.hasKey) {
      this.warnNoKey();
      return;
    }
    this.framer.setSocket(clientWs);
    this.queue.push(this.newJob(clean, this.turnStartPending, false));
    this.turnStartPending = false;
    console.log(`[gnani-tts] queued #${this.nextId - 1}: "${clean.slice(0, 60)}"`);
    this.setActive(true);
    this.pump();
  }

  sendFillerPhrase(clientWs: WebSocket): void {
    this.synthesize(this.lang.fillerPhrase, clientWs);
  }

  /** Stop all speech now: drop the queue and cancel the request in flight. */
  kill(): void {
    this.queue = [];
    this.turnStartPending = false;
    if (this.inFlight) {
      console.log(`[gnani-tts] cancelling #${this.inFlight.id}`);
      this.inFlight = null;
      this.clearRequestTimer();
      // Only closing the socket makes the server stop generating; reopen lazily.
      this.closeSocket();
    }
    this.framer.reset();
    this.setActive(false, true);
  }

  stop(): void {
    this.stopped = true;
    this.queue = [];
    this.inFlight = null;
    this.clearRequestTimer();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.closeSocket();
    this.framer.reset();
    this.setActive(false);
  }

  // ── Internal ────────────────────────────────────────────────

  private newJob(text: string, firstOfTurn: boolean, isSplit: boolean): Job {
    return {
      id: this.nextId++,
      text,
      retried: false,
      sentAt: 0,
      gotAudio: false,
      firstOfTurn,
      bytesSent: 0,
      restTried: false,
      viaRest: false,
      isSplit,
    };
  }

  /**
   * The socket could not speak `job` (an error, a stall, or the socket closed
   * after audio began). Never skip it silently: try REST once, then — for a
   * long sentence — split it in two and try again, and only then give up.
   * The queue waits meanwhile, so the order of sentences is kept.
   */
  private failJob(job: Job, reason: string): void {
    this.clearRequestTimer();
    this.framer.flush();
    if (this.inFlight !== job) return;

    if (this.fallback && !job.restTried) {
      job.restTried = true;
      job.viaRest = true;
      console.warn(`[gnani-tts] #${job.id} ${reason} — retrying over REST`);
      const req = { text: job.text, voice: this.opts.voice, model: this.opts.model, language: this.lang.ttsLanguage, speed: this.opts.speed };
      this.fallback(req).then(
        (audio) => {
          if (this.inFlight !== job) return; // cancelled meanwhile
          let pcm = stripWavHeader(audio);
          // The socket may already have played the start of this sentence.
          const skip = Math.min(pcm.length, job.bytesSent - (job.bytesSent % 2));
          if (skip > 0) pcm = pcm.subarray(skip);
          if (pcm.length > 0) this.framer.push(pcm);
          console.log(`[gnani-tts] #${job.id} spoken via REST (${pcm.length} bytes${skip ? `, skipped ${skip} already played` : ''})`);
          this.spokenThisRun++;
          this.finishJob();
        },
        (err: Error) => {
          if (this.inFlight !== job) return;
          this.giveUpOrSplit(job, `${reason}; REST: ${err.message}`);
        },
      );
      return;
    }
    this.giveUpOrSplit(job, reason);
  }

  private giveUpOrSplit(job: Job, reason: string): void {
    this.inFlight = null;
    const halves = !job.isSplit && job.bytesSent === 0 && job.text.length >= SPLIT_MIN_CHARS ? splitInTwo(job.text) : null;
    if (halves) {
      console.warn(`[gnani-tts] #${job.id} failed (${reason}) — trying it as two halves`);
      this.queue.unshift(this.newJob(halves[0], false, true), this.newJob(halves[1], false, true));
    } else {
      console.error(`[gnani-tts] #${job.id} could not be spoken (${reason}): "${job.text.slice(0, 60)}"`);
      this.failedThisRun.push(`#${job.id}: ${reason.slice(0, 80)}`);
    }
    this.pump();
  }

  private warnNoKey(): void {
    if (this.warnedNoKey) return;
    this.warnedNoKey = true;
    console.error('[gnani-tts] GNANI_API_KEY is not set — speech output is disabled. Add it to .env.');
  }

  private connect(): void {
    if (this.ws || this.stopped) return;
    console.log(`[gnani-tts] connecting — model=${this.opts.model} voice=${this.opts.voice}`);
    const ws = new WebSocket(this.opts.url, { headers: { 'X-API-Key-ID': this.opts.apiKey } });
    this.ws = ws;
    this.open = false;

    ws.on('open', () => {
      if (this.ws !== ws) return;
      this.open = true;
      this.pump();
    });

    ws.on('message', (data, isBinary) => {
      if (this.ws !== ws) return;
      this.handleMessage(data as Buffer, isBinary);
    });

    ws.on('unexpected-response', (_req, res) => {
      const hint = res.statusCode === 401 || res.statusCode === 403 ? ' — check GNANI_API_KEY' : '';
      console.error(`[gnani-tts] handshake rejected: HTTP ${res.statusCode}${hint}`);
    });

    ws.on('close', (code) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.pendingSummaries = 0;
      this.open = false;
      this.clearRequestTimer();
      const job = this.inFlight;
      if (job) {
        if (!job.retried && !job.gotAudio) {
          console.warn(`[gnani-tts] socket closed (code=${code}) mid-request — retrying #${job.id}`);
          job.retried = true;
          this.inFlight = null;
          this.queue.unshift(job);
        } else {
          // Audio had started (or the retry failed too): finish it another way.
          this.failJob(job, `socket closed (code=${code}) mid-sentence`);
          return; // failJob pumps (and reconnects) when it is done
        }
      }
      if (this.queue.length === 0 && !this.inFlight) this.setActive(false);
      if (this.queue.length > 0 && !this.stopped) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, this.opts.reconnectDelayMs);
      }
    });

    ws.on('error', (err) => {
      console.error(`[gnani-tts] socket error: ${err.message}`);
    });
  }

  private pump(): void {
    if (this.inFlight || this.stopped) return;
    if (this.queue.length > 0) this.setActive(true);
    if (this.queue.length === 0) {
      this.setActive(false);
      return;
    }
    if (!this.ws) { this.connect(); return; }
    if (!this.open || this.ws.readyState !== WebSocket.OPEN) return; // 'open' will pump

    const job = this.queue.shift()!;
    job.sentAt = Date.now();
    job.gotAudio = false;
    this.inFlight = job;
    this.ws.send(JSON.stringify({
      text: job.text,
      voice: this.opts.voice,
      model: this.opts.model,
      language: this.lang.ttsLanguage,
      speed: this.opts.speed,
      audio_config: {
        sample_rate: TTS_SAMPLE_RATE,
        num_channels: 1,
        sample_width: 2,
        encoding: 'pcm_s16le',
        container: 'raw',
      },
    }));

    this.armRequestTimer(job);
  }

  /** (Re)start the inactivity timer for the request in flight. */
  private armRequestTimer(job: Job): void {
    this.clearRequestTimer();
    this.requestTimer = setTimeout(() => {
      if (this.inFlight !== job) return;
      // The socket is unusable for this request: drop it (a fresh one is
      // opened for the next sentence) and finish this one another way.
      this.closeSocket();
      this.failJob(job, `stalled — no data for ${this.opts.requestTimeoutMs}ms`);
    }, this.opts.requestTimeoutMs);
  }

  private handleMessage(data: Buffer, isBinary: boolean): void {
    let msg: { type?: string; message?: string; data?: { audio?: string; is_final?: boolean } } | null = null;
    if (!isBinary) {
      try {
        msg = JSON.parse(data.toString());
      } catch {
        console.warn(`[gnani-tts] unparseable message: ${data.toString().slice(0, 120)}`);
        return;
      }
    }

    // Some Gnani modes (e.g. voice-clone realtime) send raw PCM as binary frames.
    if (this.inFlight && !this.inFlight.viaRest) this.armRequestTimer(this.inFlight);

    if (!msg) {
      this.handleAudio(data);
      return;
    }

    switch (msg.type) {
      case 'start':
        // A new request began: any summary still expected belonged to the past.
        this.pendingSummaries = 0;
        break;
      case 'audio': {
        const b64 = msg.data?.audio;
        if (b64) this.handleAudio(Buffer.from(b64, 'base64'));
        break;
      }
      case 'complete': {
        // The request summary that trails the end-of-audio message.
        const isSummary = !msg.data && this.pendingSummaries > 0;
        if (isSummary) {
          this.pendingSummaries--;
          break;
        }
        if (!this.inFlight || this.inFlight.viaRest) break;
        // Expect this request's summary next — unless this already was a
        // summary-style message (a server that sends only one complete).
        if (msg.data) this.pendingSummaries++;
        this.spokenThisRun++;
        this.finishJob();
        break;
      }
      case 'error': {
        const job = this.inFlight;
        console.error(`[gnani-tts] server error${job ? ` on #${job.id}` : ''}: ${msg.message ?? 'unknown'}`);
        if (job && !job.viaRest) this.failJob(job, `server error: ${msg.message ?? 'unknown'}`);
        break;
      }
      default:
        break;
    }
  }

  private handleAudio(chunk: Buffer): void {
    const job = this.inFlight;
    if (chunk.length === 0) return;
    if (job?.viaRest) return; // late socket audio for a sentence REST is now speaking
    if (!job) {
      if (this.strayAudioBytes === 0) console.warn('[gnani-tts] audio arrived with no request in flight — dropped');
      this.strayAudioBytes += chunk.length;
      return;
    }
    if (!job.gotAudio) {
      job.gotAudio = true;
      chunk = stripWavHeader(chunk);
      if (job.firstOfTurn) {
        console.log(`[latency] TTS first audio: ${Date.now() - job.sentAt}ms after request`);
      }
    }
    job.bytesSent += chunk.length;
    this.framer.push(chunk);
  }

  private finishJob(): void {
    this.clearRequestTimer();
    this.inFlight = null;
    this.framer.flush();
    this.pump();
  }

  private clearRequestTimer(): void {
    if (this.requestTimer) { clearTimeout(this.requestTimer); this.requestTimer = null; }
  }

  private closeSocket(): void {
    this.pendingSummaries = 0;
    const ws = this.ws;
    this.ws = null;
    this.open = false;
    if (ws) {
      ws.removeAllListeners('message');
      ws.on('error', () => { /* closing — ignore */ });
      ws.close();
    }
  }
}

/**
 * Split a sentence near its middle — at a clause mark if there is one, else at
 * a space — for a last attempt at speaking it. Null if it cannot be split.
 */
export function splitInTwo(text: string): [string, string] | null {
  const mid = text.length / 2;
  let best = -1;
  const consider = (re: RegExp) => {
    for (const m of text.matchAll(re)) {
      const at = (m.index ?? 0) + m[0].length;
      if (at < 8 || at > text.length - 8) continue;
      if (best < 0 || Math.abs(at - mid) < Math.abs(best - mid)) best = at;
    }
  };
  consider(/[,;:—–-]\s/g);
  if (best < 0) consider(/\s/g);
  if (best < 0) return null;
  const a = text.slice(0, best).trim();
  const b = text.slice(best).trim();
  return a && b ? [a, b] : null;
}

// ── Process-wide instance, configured from .env ───────────────

let instance: GnaniTtsClient | null = null;

export function getTts(): GnaniTtsClient {
  if (!instance) {
    const speed = parseFloat(process.env.GNANI_TTS_SPEED ?? '1.0');
    instance = new GnaniTtsClient({
      url: process.env.GNANI_TTS_URL ?? 'wss://api.vachana.ai/api/v1/tts',
      apiKey: (process.env.GNANI_API_KEY ?? '').trim(),
      model: ttsModel(),
      voice: defaultVoice(),
      speed: Number.isFinite(speed) ? Math.min(1.15, Math.max(0.85, speed)) : 1.0,
    });
  }
  return instance;
}
