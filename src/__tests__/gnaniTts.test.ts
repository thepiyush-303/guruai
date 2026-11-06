// ============================================================
// gnaniTts.test.ts — Timbre TTS client against a local mock Gnani server,
// plus the binary framing it feeds.
// ============================================================

import { AddressInfo } from 'net';
import WebSocket, { WebSocketServer } from 'ws';
import { GnaniTtsClient } from '../gnaniTts';
import { TtsFramer, stripWavHeader, WS_CHUNK_BYTES } from '../ttsFraming';
import { LANGUAGES } from '../languages';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Stands in for the browser socket: records every binary frame sent to it. */
function fakeClientSocket() {
  const frames: Buffer[] = [];
  const ws = { readyState: WebSocket.OPEN, send: (b: Buffer) => frames.push(Buffer.from(b)) };
  return { ws: ws as unknown as WebSocket, frames };
}

interface Req { text: string; language: string; voice: string; model: string; audio_config: Record<string, unknown> }

interface MockTts {
  url: string;
  requests: Req[];
  connections: number;
  /** Requests that arrived while another was still in flight (must stay 0). */
  violations: number;
  /** How the server answers a request. Default: two audio chunks then complete. */
  respond: (ws: WebSocket, req: Req) => void;
  close: () => Promise<void>;
}

function audioMsg(pcm: Buffer, i: number) {
  return JSON.stringify({ type: 'audio', data: { chunk_index: i, audio: pcm.toString('base64'), is_final: false } });
}

function startMock(): Promise<MockTts> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 });
    const sockets: WebSocket[] = [];
    const mock: MockTts = {
      url: '',
      requests: [],
      connections: 0,
      violations: 0,
      respond: (ws) => {
        ws.send(JSON.stringify({ type: 'start', request_id: 'r' }));
        ws.send(audioMsg(Buffer.alloc(3001, 1), 0)); // odd length on purpose
        ws.send(audioMsg(Buffer.alloc(1001, 2), 1));
        ws.send(JSON.stringify({ type: 'complete', data: { is_final: true, audio: '' } }));
      },
      close: () =>
        new Promise((r) => {
          for (const s of sockets) s.terminate();
          wss.close(() => r());
        }),
    };
    wss.on('connection', (ws, req) => {
      expect(req.headers['x-api-key-id']).toBe('k');
      mock.connections++;
      sockets.push(ws);
      // The docs allow one request at a time: count any pipelining.
      let busy = false;
      const rawSend = ws.send.bind(ws);
      (ws as unknown as { send: (d: string) => void }).send = (d: string) => {
        const t = JSON.parse(d).type;
        if (t === 'complete' || t === 'error') busy = false;
        rawSend(d);
      };
      ws.on('message', (data) => {
        const r = JSON.parse(data.toString()) as Req;
        if (busy) mock.violations++;
        busy = true;
        mock.requests.push(r);
        mock.respond(ws, r);
      });
    });
    wss.on('listening', () => {
      mock.url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
      resolve(mock);
    });
  });
}

describe('GnaniTtsClient', () => {
  let mock: MockTts;
  let client: GnaniTtsClient;

  beforeEach(async () => {
    mock = await startMock();
    client = new GnaniTtsClient({
      url: mock.url,
      apiKey: 'k',
      model: 'timbre-v3.0',
      voice: 'Shivani',
      speed: 1,
      framer: new TtsFramer(20),
    });
    client.configure(LANGUAGES.hi);
  });

  afterEach(async () => {
    client.stop();
    await mock.close();
  });

  it('requests raw s16le 22050 Hz audio in the session language', async () => {
    const { ws } = fakeClientSocket();
    client.synthesize('नमस्ते विद्यार्थियों', ws);
    await sleep(150);
    expect(mock.requests[0]).toMatchObject({
      text: 'नमस्ते विद्यार्थियों',
      language: 'hi-IN',
      voice: 'Shivani',
      model: 'timbre-v3.0',
      audio_config: { sample_rate: 22050, encoding: 'pcm_s16le', container: 'raw', num_channels: 1, sample_width: 2 },
    });
  });

  it('streams framed, even-length PCM to the browser socket', async () => {
    const { ws, frames } = fakeClientSocket();
    client.synthesize('one sentence', ws);
    await sleep(200);
    const total = frames.reduce((n, f) => n + f.length - 4, 0);
    expect(total).toBe(4002); // 3001 + 1001 = 4002, all of it even-aligned
    for (const [i, f] of frames.entries()) {
      expect(f[0]).toBe(0xaf);
      expect(f[1]).toBe(0xfe);
      expect(f.readUInt16LE(2)).toBe(i);
      expect((f.length - 4) % 2).toBe(0);
    }
  });

  it('sends queued sentences one at a time, in order', async () => {
    const { ws } = fakeClientSocket();
    client.synthesize('first', ws);
    client.synthesize('second', ws);
    client.synthesize('third', ws);
    await sleep(250);
    expect(mock.requests.map((r) => r.text)).toEqual(['first', 'second', 'third']);
    expect(mock.connections).toBe(1);
    expect(mock.violations).toBe(0);
  });

  it('kill() drops queued speech and ignores late audio', async () => {
    mock.respond = () => { /* never answers — request stays in flight */ };
    const { ws, frames } = fakeClientSocket();
    client.synthesize('long answer part one', ws);
    client.synthesize('part two', ws);
    await sleep(100);
    client.kill();
    await sleep(100);
    expect(mock.requests.map((r) => r.text)).toEqual(['long answer part one']);
    expect(frames.length).toBe(0);
  });

  it('does not cut off a long sentence that streams slowly (inactivity timeout, not a total cap)', async () => {
    const slow = new GnaniTtsClient({
      url: mock.url, apiKey: 'k', model: 'timbre-v3.0', voice: 'Shivani', speed: 1,
      requestTimeoutMs: 120, framer: new TtsFramer(20),
    });
    // 8 chunks 60ms apart: 480ms in total — 4x the timeout — but never 120ms silent.
    mock.respond = (ws) => {
      let i = 0;
      const t = setInterval(() => {
        if (i < 8) ws.send(audioMsg(Buffer.alloc(1000, 3), i++));
        else {
          clearInterval(t);
          ws.send(JSON.stringify({ type: 'complete', data: { is_final: true, audio: '' } }));
        }
      }, 60);
    };
    const { ws, frames } = fakeClientSocket();
    slow.synthesize('a very long sentence that takes a while to speak', ws);
    await sleep(800);
    expect(frames.reduce((n, f) => n + f.length - 4, 0)).toBe(8000);
    slow.stop();
  });

  it('abandons a request only after real silence from the server', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const stall = new GnaniTtsClient({
      url: mock.url, apiKey: 'k', model: 'timbre-v3.0', voice: 'Shivani', speed: 1,
      requestTimeoutMs: 100, framer: new TtsFramer(20),
    });
    let n = 0;
    mock.respond = (ws) => {
      if (n++ === 0) ws.send(audioMsg(Buffer.alloc(100, 1), 0)); // then nothing
      else ws.send(JSON.stringify({ type: 'complete', data: { is_final: true, audio: '' } }));
    };
    const { ws } = fakeClientSocket();
    stall.synthesize('stalls', ws);
    stall.synthesize('next one still plays', ws);
    await sleep(500);
    expect(mock.requests.map((r) => r.text)).toEqual(['stalls', 'next one still plays']);
    stall.stop();
    errSpy.mockRestore();
  });

  it('reports activity from the first sentence until the queue drains', async () => {
    const events: boolean[] = [];
    client.onActivity((a) => events.push(a));
    const { ws } = fakeClientSocket();
    client.synthesize('one', ws);
    client.synthesize('two', ws);
    expect(events).toEqual([true]);
    await sleep(250);
    expect(events).toEqual([true, false]); // once — not between the two sentences
  });

  it('reports inactive when speech is cancelled', async () => {
    mock.respond = () => { /* never completes */ };
    const events: boolean[] = [];
    client.onActivity((a) => events.push(a));
    const { ws } = fakeClientSocket();
    client.synthesize('cancel me', ws);
    await sleep(80);
    client.kill();
    expect(events).toEqual([true, false]);
  });

  it('moves on to the next sentence after a server error', async () => {
    let n = 0;
    mock.respond = (s) => {
      if (n++ === 0) s.send(JSON.stringify({ type: 'error', message: 'bad text' }));
      else s.send(JSON.stringify({ type: 'complete', data: { is_final: true, audio: '' } }));
    };
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { ws } = fakeClientSocket();
    client.synthesize('broken', ws);
    client.synthesize('fine', ws);
    await sleep(200);
    expect(mock.requests.map((r) => r.text)).toEqual(['broken', 'fine']);
    errSpy.mockRestore();
  });
});

describe('TtsFramer', () => {
  it('emits full 4 KB frames immediately and the tail on flush', () => {
    const { ws, frames } = fakeClientSocket();
    const f = new TtsFramer(10_000);
    f.setSocket(ws);
    f.push(Buffer.alloc(WS_CHUNK_BYTES + 100));
    expect(frames.map((x) => x.length)).toEqual([WS_CHUNK_BYTES + 4]);
    f.flush();
    expect(frames.map((x) => x.length)).toEqual([WS_CHUNK_BYTES + 4, 104]);
    f.reset();
  });

  it('holds back a lone odd byte until its pair arrives', () => {
    const { ws, frames } = fakeClientSocket();
    const f = new TtsFramer(10_000);
    f.setSocket(ws);
    f.push(Buffer.alloc(11));
    f.flush();
    f.push(Buffer.alloc(1));
    f.flush();
    expect(frames.map((x) => x.length - 4)).toEqual([10, 2]);
    f.reset();
  });
});

describe('stripWavHeader', () => {
  it('returns raw PCM unchanged', () => {
    const raw = Buffer.from([1, 2, 3, 4]);
    expect(stripWavHeader(raw)).toBe(raw);
  });

  it('strips a RIFF/WAVE header down to the data chunk', () => {
    const pcm = Buffer.from([9, 9, 8, 8]);
    const fmt = Buffer.alloc(16);
    const wav = Buffer.concat([
      Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'),
      Buffer.from('fmt '), Buffer.from([16, 0, 0, 0]), fmt,
      Buffer.from('data'), Buffer.from([4, 0, 0, 0]), pcm,
    ]);
    expect(stripWavHeader(wav)).toEqual(pcm);
  });
});
