// ============================================================
// ttsFraming.ts — turns a stream of raw s16le PCM into the binary
// WebSocket frames the browser plays.
//
// Frame format (unchanged from the Piper era, PRD §3.3.2):
//   [0xAF][0xFE][uint16 LE sequence][raw PCM bytes]
//
// Moved out of the old piperProcess.ts so the TTS engine can change without
// touching the wire format. One addition: payloads are always even-length.
// The client views each payload as an Int16Array, which throws on an odd byte
// count, and a network TTS can split a sample across two chunks.
// ============================================================

import WebSocket from 'ws';

/** PRD §2.4: TTS audio goes to the client in 4 KB frames. */
export const WS_CHUNK_BYTES = 4096;

/** Flush the sub-4KB tail once no audio has arrived for this long. */
const IDLE_FLUSH_MS = 200;

export class TtsFramer {
  private seq = 0;
  private socket: WebSocket | null = null;
  private pending: Buffer = Buffer.alloc(0);
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private idleFlushMs: number;

  constructor(idleFlushMs = IDLE_FLUSH_MS) {
    this.idleFlushMs = idleFlushMs;
  }

  setSocket(ws: WebSocket | null): void {
    this.socket = ws;
  }

  /** Append PCM; sends every complete 4 KB frame and schedules the tail flush. */
  push(pcm: Buffer): void {
    if (pcm.length === 0) return;
    this.pending = this.pending.length ? Buffer.concat([this.pending, pcm]) : pcm;
    while (this.pending.length >= WS_CHUNK_BYTES) {
      this.send(this.pending.subarray(0, WS_CHUNK_BYTES));
      this.pending = this.pending.subarray(WS_CHUNK_BYTES);
    }
    this.scheduleIdleFlush();
  }

  /** Send whatever is buffered now (keeping a lone odd byte for later). */
  flush(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    const even = this.pending.length - (this.pending.length % 2);
    if (even > 0) {
      this.send(this.pending.subarray(0, even));
      this.pending = this.pending.subarray(even);
    }
  }

  /** Drop everything buffered and restart the sequence (barge-in / stop). */
  reset(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    this.pending = Buffer.alloc(0);
    this.seq = 0;
  }

  private scheduleIdleFlush(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.flush();
    }, this.idleFlushMs);
  }

  private send(payload: Buffer): void {
    const ws = this.socket;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(buildFrame(payload, this.seq));
    this.seq = (this.seq + 1) & 0xffff;
  }
}

export function buildFrame(pcm: Buffer, seq: number): Buffer {
  const header = Buffer.allocUnsafe(4);
  header[0] = 0xaf;
  header[1] = 0xfe;
  header.writeUInt16LE(seq & 0xffff, 2);
  return Buffer.concat([header, pcm]);
}

/**
 * If `buf` begins with a RIFF/WAVE header, return the bytes after the `data`
 * chunk header; otherwise return `buf` unchanged. Defensive: we ask Timbre for
 * container=raw, but never want a WAV header played as a click.
 */
export function stripWavHeader(buf: Buffer): Buffer {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    return buf;
  }
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'data') return buf.subarray(off + 8);
    off += 8 + size + (size % 2);
  }
  return Buffer.alloc(0);
}
