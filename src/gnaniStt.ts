// ============================================================
// gnaniStt.ts — Gnani Prisma speech-to-text over the realtime WebSocket,
// with a REST retry. Replaces the local faster-whisper subprocess.
//
//   wss://api.vachana.ai/stt/v3/stream
//   headers: x-api-key-id, model, language_code, format, x-sample-rate, VAD tuning
//   in:  exactly-1024-byte s16le mono frames (512 samples @ 16kHz), then {"type":"commit"}
//   out: connected | speech_start | processing | transcript | error   (JSON)
//
// Prisma has no interim results: every closed segment yields exactly one
// `transcript`. The browser's Silero VAD stays authoritative for when a turn
// ends — Gnani's own VAD is set as loose as it goes (x-min-silence-ms=2000) so
// a student's mid-sentence pause does not split the utterance. At speech_end we
// send `commit`, collect every segment that belongs to the utterance, and emit
// ONE final — the same contract the state machine had with Whisper.
//
// Lessons from the live API (2026-11):
//  - language_code must be exactly ONE locale on streaming (lists → close 1008).
//    A rejected handshake is a config error: don't reconnect-loop on it.
//  - "Do not buffer and burst; this degrades VAD accuracy." Audio that queued
//    while the socket was opening (and the browser's 512ms pre-roll) is paced
//    out, never dumped at once.
//  - If streaming fails or hears nothing although the browser heard speech, the
//    utterance's audio is retried once through REST (POST /stt/v3).
// ============================================================

import WebSocket from 'ws';
import { LanguageConfig, LANGUAGES } from './languages';
import { loadVocabTerms } from './vocab';

export const STT_FRAME_BYTES = 1024;
const SAMPLE_RATE = 16000;
/** REST accepts at most 30 s of audio. */
const MAX_UTTERANCE_BYTES = 30 * SAMPLE_RATE * 2;
/** Below this much audio, an empty transcript is believable — don't retry. */
const MIN_RETRY_BYTES = Math.round(0.4 * SAMPLE_RATE * 2);

export type SttEvent =
  | {
      type: 'final';
      text: string;
      /** commit → final wall time, ms */
      duration_ms: number;
      detected_language?: string;
      /** Gnani's own reported processing latency, ms */
      gnani_latency_ms?: number;
      /** 'rest' when the streaming attempt failed and REST recovered it */
      via: 'stream' | 'rest';
    }
  | { type: 'error'; code: string; msg: string };

export type SttCallback = (ev: SttEvent) => void;

export interface GnaniSttOptions {
  url: string;
  apiKey: string;
  model: string;
  vocab?: string[];
  /** REST endpoint for the retry; '' disables it. */
  restUrl?: string;
  /** After commit with no segment ever opened: how long to wait for a late transcript. */
  commitGraceMs?: number;
  /** After commit with segments already closed: settle time for one in flight. */
  settleMs?: number;
  /** After commit: give up on streaming (then retry via REST). */
  commitTimeoutMs?: number;
  /** Max frames (32ms each) held while the socket is opening. */
  maxQueuedFrames?: number;
  /** Min gap between frames when draining a backlog (real time is 32ms). */
  paceMs?: number;
  minSilenceMs?: number;
  vadThreshold?: number;
  idleTimeoutSec?: number;
}

interface Utterance {
  segments: string[];
  segmentOpen: boolean;
  committed: boolean;
  commitAt: number;
  detected?: string;
  latency?: number;
  /** Everything sent for this utterance, for the REST retry. */
  audio: Buffer[];
  audioBytes: number;
}

export class GnaniSttClient {
  private opts: Required<GnaniSttOptions>;
  private ws: WebSocket | null = null;
  private open = false;
  private lang: LanguageConfig = LANGUAGES.en;
  /** Outgoing items in order: audio frames and control JSON. Drained by the pacer. */
  private outbox: Array<Buffer | string> = [];
  private paceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFrameAt = 0;
  private remainder: Buffer = Buffer.alloc(0);
  private utter: Utterance | null = null;
  /** Transcripts still owed for a discarded (misfire) utterance — dropped on arrival. */
  private ignoreTranscripts = 0;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private hardTimer: ReturnType<typeof setTimeout> | null = null;
  private cb: SttCallback | null = null;
  private warnedNoKey = false;
  /** Last `error` message from the server; explains a following close. */
  private lastServerError = '';
  /** The handshake was rejected for this configuration — don't reconnect until it changes. */
  private configError: string | null = null;

  constructor(opts: GnaniSttOptions) {
    this.opts = {
      vocab: [],
      restUrl: '',
      commitGraceMs: 1500,
      settleMs: 250,
      commitTimeoutMs: 6000,
      maxQueuedFrames: 320,
      paceMs: 16,
      minSilenceMs: 2000,
      vadThreshold: 0.5,
      idleTimeoutSec: 300,
      ...opts,
    };
  }

  onEvent(cb: SttCallback): void {
    this.cb = cb;
  }

  get hasKey(): boolean {
    return this.opts.apiKey.length > 0;
  }

  /** Select the language. Headers are fixed per connection, so a change reconnects. */
  configure(lang: LanguageConfig): void {
    const changed =
      lang.sttLanguageCode !== this.lang.sttLanguageCode || lang.sttFormat !== this.lang.sttFormat;
    this.lang = lang;
    if (changed) {
      this.configError = null;
      if (this.ws) {
        console.log(`[gnani-stt] language → ${lang.sttLanguageCode} (${lang.sttFormat}); reconnecting`);
        this.closeSocket();
        this.connect();
      }
    }
  }

  /** Open the socket if not already open/opening. False without a key or with a rejected config. */
  connect(): boolean {
    if (!this.hasKey) {
      if (!this.warnedNoKey) {
        console.error('[gnani-stt] GNANI_API_KEY is not set — speech recognition is disabled. Add it to .env.');
        this.warnedNoKey = true;
      }
      return false;
    }
    if (this.configError) return false;
    if (this.ws) return true;

    const headers = this.buildHeaders();
    console.log(`[gnani-stt] connecting — model=${headers.model} language=${headers.language_code} format=${headers.format}`);

    const ws = new WebSocket(this.opts.url, { headers });
    this.ws = ws;
    this.open = false;
    this.lastServerError = '';

    ws.on('open', () => {
      if (this.ws !== ws) return;
      this.open = true;
      this.drain();
    });

    ws.on('message', (data, isBinary) => {
      if (this.ws !== ws || isBinary) return;
      this.handleMessage(data.toString());
    });

    ws.on('unexpected-response', (_req, res) => {
      const hint = res.statusCode === 401 || res.statusCode === 403 ? ' — check GNANI_API_KEY' : '';
      console.error(`[gnani-stt] handshake rejected: HTTP ${res.statusCode}${hint}`);
      if (res.statusCode === 401 || res.statusCode === 403) {
        this.configError = `Gnani rejected the API key (HTTP ${res.statusCode})`;
      }
    });

    ws.on('close', (code, reason) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.open = false;
      this.stopPacer();
      this.outbox = [];
      const why = reason.toString() || this.lastServerError;
      if (code === 1008) {
        // The server refused this configuration. Reconnecting with the same
        // headers would fail the same way — wait for configure() to change it.
        this.configError = why || 'invalid handshake headers';
        console.error(`[gnani-stt] configuration rejected (1008): ${this.configError}`);
      } else {
        console.log(`[gnani-stt] socket closed (code=${code}${why ? ` ${why}` : ''}); will reconnect on next utterance`);
      }
      // An utterance waiting on this socket cannot complete over streaming now.
      if (this.utter?.committed) {
        void this.recover('STT_DISCONNECTED', `Gnani STT connection closed (${code})${why ? `: ${why}` : ''}`);
      }
    });

    ws.on('error', (err) => {
      console.error(`[gnani-stt] socket error: ${err.message}`);
      // 'close' follows.
    });

    return true;
  }

  /** A new utterance begins (client speech_start). */
  beginUtterance(): void {
    this.clearTimers();
    this.utter = { segments: [], segmentOpen: false, committed: false, commitAt: 0, audio: [], audioBytes: 0 };
    this.remainder = Buffer.alloc(0);
    this.connect();
  }

  /** Stream one PCM chunk of the current utterance. Re-chunks to exact 1024-byte frames. */
  writeChunk(pcm: Buffer): void {
    const u = this.utter;
    if (!u || u.committed || !this.hasKey) return;
    if (u.audioBytes + pcm.length <= MAX_UTTERANCE_BYTES) {
      u.audio.push(Buffer.from(pcm));
      u.audioBytes += pcm.length;
    }
    let buf = this.remainder.length ? Buffer.concat([this.remainder, pcm]) : pcm;
    while (buf.length >= STT_FRAME_BYTES) {
      this.send(Buffer.from(buf.subarray(0, STT_FRAME_BYTES)));
      buf = buf.subarray(STT_FRAME_BYTES);
    }
    this.remainder = Buffer.from(buf);
  }

  /** End of utterance (client speech_end): flush, commit, and wait for the final. */
  commit(): void {
    const u = this.utter;
    if (!u || u.committed) return;

    if (!this.hasKey) {
      this.utter = null;
      this.cb?.({ type: 'error', code: 'NO_API_KEY', msg: 'GNANI_API_KEY is not set' });
      return;
    }

    u.committed = true;
    u.commitAt = Date.now();

    // Streaming is unavailable for this configuration — go straight to REST.
    if (this.configError || !this.ws) {
      void this.recover('STT_CONFIG', this.configError ?? 'Gnani STT socket unavailable');
      return;
    }

    if (this.remainder.length > 0) {
      const padded = Buffer.alloc(STT_FRAME_BYTES, 0);
      this.remainder.copy(padded);
      this.send(padded);
      this.remainder = Buffer.alloc(0);
    }
    this.send(JSON.stringify({ type: 'commit' }));

    // Allow for frames still being paced out of the backlog.
    const backlogMs = this.queuedFrames() * this.opts.paceMs;
    this.hardTimer = setTimeout(() => {
      void this.recover('STT_TIMEOUT', `No transcript from Gnani within ${this.opts.commitTimeoutMs}ms`);
    }, this.opts.commitTimeoutMs + backlogMs);

    this.evaluate();
  }

  /** VAD misfire: drop this utterance, including any transcript still on its way. */
  discard(): void {
    const u = this.utter;
    this.clearTimers();
    this.utter = null;
    this.remainder = Buffer.alloc(0);
    if (u && !u.committed && u.segmentOpen) {
      // Close the server-side segment now so its transcript cannot leak into
      // the next utterance; we drop it when it arrives.
      this.ignoreTranscripts++;
      this.send(JSON.stringify({ type: 'commit' }));
    }
  }

  stop(): void {
    this.clearTimers();
    this.utter = null;
    this.closeSocket();
  }

  // ── Internal: sending ───────────────────────────────────────

  private buildHeaders(): Record<string, string> {
    const h: Record<string, string> = {
      'x-api-key-id': this.opts.apiKey,
      model: this.opts.model,
      language_code: this.lang.sttLanguageCode,
      format: this.lang.sttFormat,
      'x-sample-rate': String(SAMPLE_RATE),
      'x-min-silence-ms': String(this.opts.minSilenceMs),
      'x-vad-threshold': String(this.opts.vadThreshold),
      'x-idle-timeout-sec': String(this.opts.idleTimeoutSec),
    };
    const terms = this.asciiVocab();
    if (terms.length > 0) {
      h[this.isV3() ? 'keyterms' : 'bias_list'] = terms.join(',');
    }
    return h;
  }

  private isV3(): boolean {
    return /v3/.test(this.opts.model);
  }

  /** HTTP header values must be latin1; non-ASCII terms are skipped. */
  private asciiVocab(): string[] {
    return this.opts.vocab.filter((t) => /^[\x20-\x7e]+$/.test(t));
  }

  private queuedFrames(): number {
    let n = 0;
    for (const x of this.outbox) if (typeof x !== 'string') n++;
    return n;
  }

  private send(item: Buffer | string): void {
    if (!this.ws && !this.connect()) return;
    this.outbox.push(item);
    // Bound memory if the socket never opens: drop the oldest audio, keep control messages.
    let frames = this.queuedFrames();
    while (frames > this.opts.maxQueuedFrames) {
      const idx = this.outbox.findIndex((x) => typeof x !== 'string');
      if (idx < 0) break;
      this.outbox.splice(idx, 1);
      frames--;
    }
    this.drain();
  }

  /**
   * Send what is queued, never faster than one frame per paceMs. In steady
   * state frames arrive every 32ms and go out immediately; only a backlog
   * (socket just opened, pre-roll flush) is spread out.
   */
  private drain(): void {
    if (this.paceTimer || !this.ws || !this.open || this.ws.readyState !== WebSocket.OPEN) return;
    const ws = this.ws;
    while (this.outbox.length > 0) {
      const next = this.outbox[0];
      if (typeof next === 'string') {
        ws.send(this.outbox.shift()!);
        continue;
      }
      const wait = this.lastFrameAt + this.opts.paceMs - Date.now();
      if (wait > 0) {
        this.paceTimer = setTimeout(() => {
          this.paceTimer = null;
          this.drain();
        }, wait);
        return;
      }
      ws.send(this.outbox.shift()!);
      this.lastFrameAt = Date.now();
    }
  }

  private stopPacer(): void {
    if (this.paceTimer) { clearTimeout(this.paceTimer); this.paceTimer = null; }
  }

  // ── Internal: receiving ─────────────────────────────────────

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      console.warn(`[gnani-stt] unparseable message: ${raw.slice(0, 120)}`);
      return;
    }

    switch (msg.type) {
      case 'connected':
        console.log('[gnani-stt] connected');
        break;

      case 'speech_start':
        if (this.utter) {
          this.utter.segmentOpen = true;
          // A segment opened during the post-commit settle window — wait for it.
          if (this.utter.committed && this.settleTimer) {
            clearTimeout(this.settleTimer);
            this.settleTimer = null;
          }
        }
        break;

      case 'transcript': {
        if (this.ignoreTranscripts > 0) {
          this.ignoreTranscripts--;
          return;
        }
        const u = this.utter;
        if (!u) {
          console.log(`[gnani-stt] dropping transcript with no open utterance: "${String(msg.text ?? '').slice(0, 60)}"`);
          return;
        }
        const text = String(msg.text ?? '').trim();
        if (text) u.segments.push(text);
        u.segmentOpen = false;
        if (typeof msg.detected_language_code === 'string') u.detected = msg.detected_language_code;
        if (typeof msg.latency === 'number') u.latency = msg.latency;
        // A transcript after the commit is the segment the commit closed — no
        // other audio follows it, so the utterance is complete. Don't wait.
        if (u.committed) this.finishStream();
        break;
      }

      case 'error': {
        const m = String(msg.message ?? 'unknown error');
        this.lastServerError = m;
        console.error(`[gnani-stt] server error: ${m}`);
        if (this.utter?.committed) void this.recover('STT_FAIL', m);
        break;
      }

      default:
        // processing, settings_updated, … — informational
        break;
    }
  }

  /** After commit: decide whether the utterance is complete. */
  private evaluate(): void {
    const u = this.utter;
    if (!u || !u.committed) return;
    if (u.segmentOpen) return; // its transcript is coming
    if (this.settleTimer) clearTimeout(this.settleTimer);
    // Segments in hand: settle briefly in case one more is in flight.
    // None yet: the last frames may still be on the wire — wait longer.
    const backlogMs = this.queuedFrames() * this.opts.paceMs;
    const wait = (u.segments.length > 0 ? this.opts.settleMs : this.opts.commitGraceMs) + backlogMs;
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      if (this.utter === u && !u.segmentOpen) this.finishStream();
    }, wait);
  }

  /** Streaming produced its answer. An empty one for real speech gets a REST retry. */
  private finishStream(): void {
    const u = this.utter;
    if (!u) return;
    const text = u.segments.join(' ').trim();
    if (!text && u.audioBytes >= MIN_RETRY_BYTES && this.opts.restUrl) {
      void this.recover('STT_EMPTY', 'streaming returned no text');
      return;
    }
    this.clearTimers();
    this.utter = null;
    this.cb?.({
      type: 'final',
      text,
      duration_ms: Date.now() - u.commitAt,
      detected_language: u.detected,
      gnani_latency_ms: u.latency,
      via: 'stream',
    });
  }

  /**
   * Streaming failed for this utterance. Retry its audio once over REST; if
   * that is unavailable or fails too, report the error.
   */
  private async recover(code: string, msg: string): Promise<void> {
    const u = this.utter;
    if (!u) return;
    this.clearTimers();
    this.utter = null; // late stream messages for this utterance are now ignored

    if (!this.opts.restUrl || u.audioBytes < MIN_RETRY_BYTES) {
      if (code === 'STT_EMPTY') {
        this.cb?.({ type: 'final', text: '', duration_ms: Date.now() - u.commitAt, via: 'stream' });
      } else {
        this.cb?.({ type: 'error', code, msg });
      }
      return;
    }

    console.warn(`[gnani-stt] ${code} (${msg}) — retrying ${(u.audioBytes / 32000).toFixed(1)}s of audio over REST`);
    try {
      const r = await this.transcribeRest(Buffer.concat(u.audio));
      this.cb?.({
        type: 'final',
        text: r.text,
        duration_ms: Date.now() - u.commitAt,
        detected_language: r.detected,
        via: 'rest',
      });
    } catch (err) {
      const restMsg = (err as Error).message;
      console.error(`[gnani-stt] REST retry failed: ${restMsg}`);
      this.cb?.({ type: 'error', code, msg: `${msg}; REST retry: ${restMsg}` });
    }
  }

  private async transcribeRest(pcm: Buffer): Promise<{ text: string; detected?: string }> {
    const form = new FormData();
    form.append('audio_file', new Blob([wavFromPcm(pcm)], { type: 'audio/wav' }), 'utterance.wav');
    if (this.isV3()) form.append('model', this.opts.model);
    form.append('language_code', this.lang.sttLanguageCode);
    form.append('format', this.lang.sttFormat);
    const terms = this.asciiVocab();
    if (terms.length > 0) form.append(this.isV3() ? 'keyterms' : 'bias_list', terms.join(','));

    const res = await fetch(this.opts.restUrl, {
      method: 'POST',
      headers: { 'X-API-Key-ID': this.opts.apiKey },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || body.success === false) {
      const detail = (body.detail as Record<string, unknown> | undefined)?.message ?? body.message ?? res.statusText;
      throw new Error(`HTTP ${res.status}: ${String(detail)}`);
    }
    return {
      text: String(body.transcript ?? '').trim(),
      detected: typeof body.detected_language_code === 'string' ? body.detected_language_code : undefined,
    };
  }

  private clearTimers(): void {
    if (this.settleTimer) { clearTimeout(this.settleTimer); this.settleTimer = null; }
    if (this.hardTimer) { clearTimeout(this.hardTimer); this.hardTimer = null; }
  }

  private closeSocket(): void {
    const ws = this.ws;
    this.ws = null;
    this.open = false;
    this.stopPacer();
    this.outbox = [];
    this.ignoreTranscripts = 0;
    if (ws) {
      ws.removeAllListeners('message');
      ws.on('error', () => { /* closing — ignore */ });
      ws.close();
    }
  }
}

/** Wrap 16 kHz mono s16le PCM in a WAV header for the REST endpoint. */
export function wavFromPcm(pcm: Buffer, sampleRate = SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);        // fmt chunk size
  header.writeUInt16LE(1, 20);         // PCM
  header.writeUInt16LE(1, 22);         // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);         // block align
  header.writeUInt16LE(16, 34);        // bits per sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// ── Process-wide instance, configured from .env ───────────────

let instance: GnaniSttClient | null = null;

function envNumber(name: string, fallback: number): number {
  const v = parseFloat(process.env[name] ?? '');
  return Number.isFinite(v) ? v : fallback;
}

export function getStt(): GnaniSttClient {
  if (!instance) {
    instance = new GnaniSttClient({
      url: process.env.GNANI_STT_URL ?? 'wss://api.vachana.ai/stt/v3/stream',
      restUrl: process.env.GNANI_STT_REST_URL ?? 'https://api.vachana.ai/stt/v3',
      apiKey: (process.env.GNANI_API_KEY ?? '').trim(),
      model: process.env.GNANI_STT_MODEL ?? 'prisma-v3.0',
      vocab: loadVocabTerms(),
      vadThreshold: Math.min(1, Math.max(0, envNumber('GNANI_STT_VAD_THRESHOLD', 0.5))),
      paceMs: Math.max(1, envNumber('GNANI_STT_PACE_MS', 16)),
    });
  }
  return instance;
}
