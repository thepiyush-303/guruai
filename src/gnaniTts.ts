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
}

interface Job {
  id: number;
  text: string;
  retried: boolean;
  sentAt: number;
  gotAudio: boolean;
  /** First sentence of a turn — logs time-to-first-audio. */
  firstOfTurn: boolean;
}

export class GnaniTtsClient {
  private opts: Required<Omit<GnaniTtsOptions, 'framer'>>;
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
  private activityCb: ((active: boolean) => void) | null = null;
  private spokenThisRun = 0;

  constructor(opts: GnaniTtsOptions) {
    this.opts = {
      requestTimeoutMs: 12_000,
      reconnectDelayMs: 500,
      ...opts,
    };
    this.framer = opts.framer ?? new TtsFramer();
  }

  get hasKey(): boolean {
    return this.opts.apiKey.length > 0;
  }

  /**
   * Notified when speech output starts (first sentence queued) and when it is
   * finished (queue drained or cancelled). The client keeps its mic closed in
   * between, including the gaps between sentences.
   */
  onActivity(cb: (active: boolean) => void): void {
    this.activityCb = cb;
  }

  private setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (active) this.spokenThisRun = 0;
    else console.log(`[gnani-tts] queue drained — ${this.spokenThisRun} sentence(s) spoken`);
    this.activityCb?.(active);
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
    this.queue.push({
      id: this.nextId++,
      text: clean,
      retried: false,
      sentAt: 0,
      gotAudio: false,
      firstOfTurn: this.turnStartPending,
    });
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
    this.setActive(false);
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
      this.open = false;
      this.clearRequestTimer();
      const job = this.inFlight;
      this.inFlight = null;
      if (job) {
        if (!job.retried && !job.gotAudio) {
          console.warn(`[gnani-tts] socket closed (code=${code}) mid-request — retrying #${job.id}`);
          job.retried = true;
          this.queue.unshift(job);
        } else {
          console.warn(`[gnani-tts] socket closed (code=${code}) mid-request — dropping #${job.id}`);
          this.framer.flush();
        }
      }
      if (this.queue.length === 0) this.setActive(false);
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
      console.error(`[gnani-tts] #${job.id} stalled — no data for ${this.opts.requestTimeoutMs}ms; skipping "${job.text.slice(0, 40)}"`);
      this.inFlight = null;
      this.framer.flush();
      this.closeSocket();
      this.pump();
    }, this.opts.requestTimeoutMs);
  }

  private handleMessage(data: Buffer, isBinary: boolean): void {
    let msg: { type?: string; message?: string; data?: { audio?: string } } | null = null;
    if (!isBinary) {
      try {
        msg = JSON.parse(data.toString());
      } catch {
        console.warn(`[gnani-tts] unparseable message: ${data.toString().slice(0, 120)}`);
        return;
      }
    }

    // Some Gnani modes (e.g. voice-clone realtime) send raw PCM as binary frames.
    if (this.inFlight) this.armRequestTimer(this.inFlight);

    if (!msg) {
      this.handleAudio(data);
      return;
    }

    switch (msg.type) {
      case 'start':
        break;
      case 'audio': {
        const b64 = msg.data?.audio;
        if (b64) this.handleAudio(Buffer.from(b64, 'base64'));
        break;
      }
      case 'complete':
        this.spokenThisRun++;
        this.finishJob();
        break;
      case 'error':
        console.error(`[gnani-tts] server error${this.inFlight ? ` on #${this.inFlight.id}` : ''}: ${msg.message ?? 'unknown'}`);
        this.finishJob();
        break;
      default:
        break;
    }
  }

  private handleAudio(chunk: Buffer): void {
    const job = this.inFlight;
    if (!job || chunk.length === 0) return;
    if (!job.gotAudio) {
      job.gotAudio = true;
      chunk = stripWavHeader(chunk);
      if (job.firstOfTurn) {
        console.log(`[latency] TTS first audio: ${Date.now() - job.sentAt}ms after request`);
      }
    }
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
