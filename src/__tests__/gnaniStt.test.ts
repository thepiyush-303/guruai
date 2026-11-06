// ============================================================
// gnaniStt.test.ts — Prisma STT client against a local mock Gnani server.
// ============================================================

import { AddressInfo } from 'net';
import * as http from 'http';
import { IncomingHttpHeaders } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { GnaniSttClient, STT_FRAME_BYTES, SttEvent } from '../gnaniStt';
import { LANGUAGES } from '../languages';

interface MockServer {
  url: string;
  frames: number[];               // byte length of every binary frame received
  commits: number;
  headers: IncomingHttpHeaders[];
  sockets: WebSocket[];
  /** Called on every commit; lets each test script the server's reply. */
  onCommit: (ws: WebSocket) => void;
  /** Called on connect; lets a test reject the handshake like Gnani does. */
  onConnect: (ws: WebSocket, headers: IncomingHttpHeaders) => void;
  /** Arrival time of every binary frame. */
  frameTimes: number[];
  close: () => Promise<void>;
}

function startMock(): Promise<MockServer> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 });
    const mock: MockServer = {
      url: '',
      frames: [],
      commits: 0,
      headers: [],
      sockets: [],
      onCommit: () => {},
      onConnect: () => {},
      frameTimes: [],
      close: () =>
        new Promise((r) => {
          for (const s of mock.sockets) s.terminate();
          wss.close(() => r());
        }),
    };
    wss.on('connection', (ws, req) => {
      mock.headers.push(req.headers);
      mock.sockets.push(ws);
      ws.send(JSON.stringify({ type: 'connected', message: 'ok' }));
      mock.onConnect(ws, req.headers);
      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          mock.frames.push((data as Buffer).length);
          mock.frameTimes.push(Date.now());
          return;
        }
        const msg = JSON.parse(data.toString());
        if (msg.type === 'commit') {
          mock.commits++;
          mock.onCommit(ws);
        }
      });
    });
    wss.on('listening', () => {
      mock.url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
      resolve(mock);
    });
  });
}

const send = (ws: WebSocket, msg: object) => ws.send(JSON.stringify(msg));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function nextEvent(client: GnaniSttClient, timeoutMs = 3000): Promise<SttEvent> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no STT event')), timeoutMs);
    client.onEvent((ev) => {
      clearTimeout(t);
      resolve(ev);
    });
  });
}

function makeClient(url: string, extra: Partial<ConstructorParameters<typeof GnaniSttClient>[0]> = {}) {
  return new GnaniSttClient({
    url,
    apiKey: 'test-key',
    model: 'prisma-v3.0',
    vocab: ['NCERT', 'प्रकाश'],
    commitGraceMs: 150,
    settleMs: 50,
    commitTimeoutMs: 1000,
    ...extra,
  });
}

describe('GnaniSttClient', () => {
  let mock: MockServer;
  let client: GnaniSttClient;

  beforeEach(async () => {
    mock = await startMock();
    client = makeClient(mock.url);
  });

  afterEach(async () => {
    client.stop();
    await mock.close();
  });

  it('connects with ONE locale, the language format, VAD tuning and ASCII-only keyterms', async () => {
    client.configure(LANGUAGES.hinglish);
    client.connect();
    await sleep(100);
    const h = mock.headers[0];
    expect(h['x-api-key-id']).toBe('test-key');
    expect(h['model']).toBe('prisma-v3.0');
    expect(h['language_code']).toBe('hi-IN');
    expect(h['format']).toBe('codemix');
    expect(h['x-sample-rate']).toBe('16000');
    expect(h['x-vad-threshold']).toBe('0.5');
    expect(h['keyterms']).toBe('NCERT'); // non-latin1 term skipped
  });

  it('paces a backlog of frames instead of bursting it', async () => {
    mock.onCommit = (ws) => send(ws, { type: 'transcript', text: 'ok' });
    client.beginUtterance();                        // socket still opening
    client.writeChunk(Buffer.alloc(STT_FRAME_BYTES * 10));
    const ev = nextEvent(client);
    client.commit();
    await ev;
    expect(mock.frames.length).toBe(10);
    const gaps = mock.frameTimes.slice(1).map((t, i) => t - mock.frameTimes[i]);
    const span = mock.frameTimes[9] - mock.frameTimes[0];
    expect(span).toBeGreaterThanOrEqual(9 * 16 - 10); // ~16ms apart, not all at once
    expect(Math.max(...gaps)).toBeLessThan(200);
  });

  it('does not reconnect-loop after the server rejects the configuration (1008)', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mock.onConnect = (ws) => {
      send(ws, { type: 'error', message: 'Invalid language_code: exactly one locale is required' });
      ws.close(1008, '');
    };
    client.connect();
    await sleep(100);
    client.beginUtterance();
    client.writeChunk(Buffer.alloc(STT_FRAME_BYTES * 20));
    const ev = nextEvent(client);
    client.commit();
    const result = await ev;
    expect(result).toMatchObject({ type: 'error', code: 'STT_CONFIG' });
    expect((result as { msg: string }).msg).toContain('exactly one locale');
    expect(mock.headers.length).toBe(1); // no second attempt with the same headers

    // A new configuration may try again.
    mock.onConnect = () => {};
    client.configure(LANGUAGES.hi);
    client.connect();
    await sleep(100);
    expect(mock.headers.length).toBe(2);
    errSpy.mockRestore();
  });

  it('re-chunks audio into exact 1024-byte frames and pads the tail on commit', async () => {
    mock.onCommit = (ws) => send(ws, { type: 'transcript', text: 'hello' });
    client.beginUtterance();
    client.writeChunk(Buffer.alloc(1500));
    client.writeChunk(Buffer.alloc(600)); // 2100 total → 2 frames + 52 bytes
    const ev = nextEvent(client);
    client.commit();
    expect((await ev).type).toBe('final');
    expect(mock.frames).toEqual([STT_FRAME_BYTES, STT_FRAME_BYTES, STT_FRAME_BYTES]);
  });

  it('waits for the transcript of a segment still open at commit', async () => {
    client.beginUtterance();
    await sleep(80);
    send(mock.sockets[0], { type: 'speech_start' });
    await sleep(30);
    mock.onCommit = (ws) => setTimeout(() => send(ws, { type: 'transcript', text: 'न्यूटन का नियम', latency: 120, detected_language_code: 'hi-IN' }), 300);
    const ev = nextEvent(client);
    client.commit();
    const final = await ev;
    expect(final).toMatchObject({ type: 'final', text: 'न्यूटन का नियम', gnani_latency_ms: 120, detected_language: 'hi-IN' });
  });

  it('joins several segments of one utterance into a single final', async () => {
    client.beginUtterance();
    await sleep(80);
    const ws = mock.sockets[0];
    send(ws, { type: 'speech_start' });
    send(ws, { type: 'transcript', text: 'what is' });
    send(ws, { type: 'speech_start' });
    await sleep(30);
    mock.onCommit = (s) => send(s, { type: 'transcript', text: 'photosynthesis' });
    const ev = nextEvent(client);
    client.commit();
    expect(await ev).toMatchObject({ type: 'final', text: 'what is photosynthesis' });
  });

  it('emits an empty final when Gnani heard no speech', async () => {
    client.beginUtterance();
    await sleep(50);
    const ev = nextEvent(client);
    client.commit();
    expect(await ev).toMatchObject({ type: 'final', text: '' });
  });

  it('reports STT_TIMEOUT when an open segment never completes', async () => {
    client.beginUtterance();
    await sleep(80);
    send(mock.sockets[0], { type: 'speech_start' });
    await sleep(30);
    const ev = nextEvent(client);
    client.commit();
    expect(await ev).toMatchObject({ type: 'error', code: 'STT_TIMEOUT' });
  });

  it('drops the transcript of a discarded (misfire) utterance', async () => {
    client.beginUtterance();
    await sleep(80);
    const ws = mock.sockets[0];
    send(ws, { type: 'speech_start' });
    await sleep(30);
    mock.onCommit = (s) => send(s, { type: 'transcript', text: 'noise' });
    client.discard();
    await sleep(80);

    mock.onCommit = (s) => send(s, { type: 'transcript', text: 'real question' });
    client.beginUtterance();
    const ev = nextEvent(client);
    client.commit();
    expect(await ev).toMatchObject({ type: 'final', text: 'real question' });
  });

  it('queues audio sent before the socket opens', async () => {
    mock.onCommit = (ws) => send(ws, { type: 'transcript', text: 'ok' });
    client.beginUtterance();          // starts connecting
    client.writeChunk(Buffer.alloc(STT_FRAME_BYTES * 3));
    const ev = nextEvent(client);
    client.commit();
    await ev;
    expect(mock.frames.length).toBe(3);
  });

  it('reconnects with new headers when the language changes', async () => {
    client.connect();
    await sleep(80);
    client.configure(LANGUAGES.ta);
    await sleep(80);
    expect(mock.headers.length).toBe(2);
    expect(mock.headers[1]['language_code']).toBe('ta-IN');
  });

  describe('REST retry', () => {
    let rest: http.Server;
    let restUrl = '';
    let restCalls: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];

    beforeEach(async () => {
      restCalls = [];
      rest = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          restCalls.push({ headers: req.headers, body: Buffer.concat(chunks).toString('latin1') });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, transcript: 'recovered over rest', detected_language_code: 'hi-IN' }));
        });
      });
      await new Promise<void>((r) => rest.listen(0, '127.0.0.1', () => r()));
      restUrl = `http://127.0.0.1:${(rest.address() as AddressInfo).port}/stt/v3`;
    });

    afterEach(async () => {
      await new Promise<void>((r) => rest.close(() => r()));
    });

    it('retries over REST when streaming hears nothing in real speech', async () => {
      const c = makeClient(mock.url, { restUrl });
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      c.configure(LANGUAGES.hinglish);
      c.beginUtterance();
      c.writeChunk(Buffer.alloc(STT_FRAME_BYTES * 30)); // ~1 s
      const ev = nextEvent(c);
      c.commit();
      expect(await ev).toMatchObject({ type: 'final', text: 'recovered over rest', via: 'rest' });
      expect(restCalls).toHaveLength(1);
      expect(restCalls[0].headers['x-api-key-id']).toBe('test-key');
      const body = restCalls[0].body;
      expect(body).toContain('RIFF');                // a WAV upload
      expect(body).toContain('name="language_code"\r\n\r\nhi-IN');
      expect(body).toContain('name="format"\r\n\r\ncodemix');
      c.stop();
      warn.mockRestore();
    });

    it('does not retry a short blip', async () => {
      const c = makeClient(mock.url, { restUrl });
      c.beginUtterance();
      c.writeChunk(Buffer.alloc(STT_FRAME_BYTES * 3)); // ~0.1 s
      const ev = nextEvent(c);
      c.commit();
      expect(await ev).toMatchObject({ type: 'final', text: '' });
      expect(restCalls).toHaveLength(0);
      c.stop();
    });

    it('recovers an utterance whose socket was rejected', async () => {
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mock.onConnect = (ws) => ws.close(1008, 'bad header');
      const c = makeClient(mock.url, { restUrl });
      c.beginUtterance();
      await sleep(100);
      c.writeChunk(Buffer.alloc(STT_FRAME_BYTES * 30));
      const ev = nextEvent(c);
      c.commit();
      expect(await ev).toMatchObject({ type: 'final', text: 'recovered over rest', via: 'rest' });
      c.stop();
      errSpy.mockRestore();
      warn.mockRestore();
    });
  });

  it('fails each commit with NO_API_KEY when unconfigured', async () => {
    const noKey = makeClient(mock.url, { apiKey: '' });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const ev = nextEvent(noKey);
    noKey.beginUtterance();
    noKey.writeChunk(Buffer.alloc(2048));
    noKey.commit();
    expect(await ev).toMatchObject({ type: 'error', code: 'NO_API_KEY' });
    expect(mock.headers.length).toBe(0);
    errSpy.mockRestore();
  });
});
